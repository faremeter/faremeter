#!/usr/bin/env pnpm tsx

import t from "tap";
import { $ } from "zx/core";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, delimiter } from "node:path";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { configureApp } from "@faremeter/logs";
import { loadSpec } from "@faremeter/middleware-openapi";
import type { CaptureResponse } from "@faremeter/middleware-openapi";
import {
  createTestFacilitatorHandler,
  createTestMPPHandler,
  createTestPaymentHandler,
  createTestMPPPaymentHandler,
  TEST_SCHEME,
  TEST_NETWORK,
  TEST_ASSET,
  generateTestId,
} from "@faremeter/test-harness";
import { createApp } from "@faremeter/sidecar/app";
import { wrap } from "@faremeter/fetch";
import { client } from "@faremeter/types";
import { normalizeNetworkId } from "@faremeter/info";

$.verbose = false;

const metaDir = import.meta.dirname;
if (!metaDir) throw new Error("import.meta.dirname is not available");
const REPO_ROOT = resolve(metaDir, "../..");
const SPEC_PATH = resolve(metaDir, "openapi.yaml");
const SIDECAR_PORT = 4002;
const UPSTREAM_PORT = 4100;
const NGINX_PORT = 8080;
const NGINX_BASE = `http://127.0.0.1:${NGINX_PORT}`;
const TMP_DIR = join(REPO_ROOT, "tmp", "nginx-sidecar-test");

// -- OpenResty resolution --

function resolveOpenResty(): string | null {
  const override = process.env.FAREMETER_OPENRESTY_BIN;
  if (override) {
    return existsSync(override) ? override : null;
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, "openresty");
    if (existsSync(candidate)) return candidate;
  }

  const fallbacks = [
    "/opt/homebrew/bin/openresty",
    "/usr/local/bin/openresty",
    "/usr/local/openresty/bin/openresty",
    "/usr/bin/openresty",
  ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

const OPENRESTY_BIN = resolveOpenResty();

if (!OPENRESTY_BIN) {
  t.comment("openresty not found, skipping nginx sidecar integration tests");
  process.exit(0);
}

const opmBin = join(resolve(OPENRESTY_BIN, ".."), "opm");
const opmResult =
  await $`${opmBin} list 2>/dev/null | grep lua-resty-http`.nothrow();
if (opmResult.exitCode !== 0) {
  t.comment(
    "lua-resty-http not found (opm install ledgetech/lua-resty-http), skipping",
  );
  process.exit(0);
}

// -- Health check --

async function waitForHealth(url: string): Promise<void> {
  const timeoutMs = 30_000;
  const maxDelay = 1_000;
  let delay = 50;
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`health check returned ${response.status}`);
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, maxDelay);
  }

  throw new Error(`timed out waiting for ${url} after ${timeoutMs}ms`, {
    cause: lastError,
  });
}

// -- Nginx config generation --

async function generateNginxConfig(outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  // Generate the server-block fragment via the CLI.
  const cliPath = join(REPO_ROOT, "packages/gateway-nginx/src/cli.ts");
  await $`pnpm tsx ${cliPath} \
    --spec ${SPEC_PATH} \
    --sidecar http://127.0.0.1:${SIDECAR_PORT} \
    --upstream http://127.0.0.1:${UPSTREAM_PORT} \
    --output ${outputDir}`;

  // Read the generated location blocks.
  const locations = await readFile(join(outputDir, "locations.conf"), "utf-8");

  // Wrap in the outer shell that an operator would provide.
  const pidPath = join(outputDir, "nginx.pid");
  const errorLogPath = join(outputDir, "error.log");
  const luaPath = join(outputDir, "lua");

  const indentedLocations = locations
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : "    " + line))
    .join("\n");

  const conf = [
    `daemon off;`,
    `pid ${pidPath};`,
    `error_log ${errorLogPath} info;`,
    "",
    "worker_processes auto;",
    "",
    "events {",
    "  worker_connections 1024;",
    "}",
    "",
    "http {",
    `  lua_package_path "${luaPath}/?.lua;;";`,
    "  lua_shared_dict fm_capture_buffer 10m;",
    "  lua_max_pending_timers 4096;",
    "  lua_max_running_timers 1024;",
    "",
    "  server {",
    "    listen 8080;",
    "",
    indentedLocations,
    "",
    `    location / {`,
    `      proxy_pass http://127.0.0.1:${UPSTREAM_PORT};`,
    `      proxy_set_header Host $host;`,
    `      proxy_set_header X-Real-IP $remote_addr;`,
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");

  const confPath = join(outputDir, "nginx.conf");
  await writeFile(confPath, conf);
  return confPath;
}

// -- Mock upstream --

function createMockUpstream(): Hono {
  const app = new Hono();

  app.post("/v1/chat/completions", (c) =>
    c.json({
      id: "chatcmpl-test-001",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "Hello from mock" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
  );

  app.post("/v1/chat/stream", () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunks = [
          { choices: [{ delta: { content: "Hello" } }] },
          { choices: [{ delta: { content: " world" } }] },
          {
            choices: [{ delta: {} }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          },
        ];
        for (const chunk of chunks) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/v1/images/generations", (c) =>
    c.json({
      data: [{ url: "https://example.com/img.png" }],
      usage: { count: 1 },
    }),
  );

  app.get("/v1/data", (c) => c.json({ items: [{ id: 1 }, { id: 2 }] }));

  app.post("/v1/data", (c) => c.json({ created: true, usage: { count: 5 } }));

  // Capture failure: returns a body missing the `usage` field.
  app.post("/v1/unstable", (c) =>
    c.json({ error: "upstream hiccup", code: "TRANSIENT" }),
  );

  // Match filter routing: returns usage with total_tokens.
  app.post("/v1/models", (c) =>
    c.json({ model: "echo", usage: { total_tokens: 20 } }),
  );

  // Rate cascade: same shape as chat completions.
  app.post("/v1/premium", (c) =>
    c.json({ tier: "premium", usage: { total_tokens: 10 } }),
  );

  // coalesce/jsonSize: same shape as chat completions.
  app.post("/v1/estimate", (c) => c.json({ usage: { total_tokens: 40 } }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

// -- Callback tracking --

type SettleRecord = { requirementsAmount: string; network: string };

type Callbacks = {
  x402VerifyCount: number;
  x402SettleCount: number;
  x402SettleRecords: SettleRecord[];
  mppSettleCount: number;
  captures: Map<string, CaptureResponse>;
  awaitX402Settle(): Promise<void>;
  awaitCapture(operationKey: string): Promise<void>;
  reset(): void;
};

type Waiter = { resolve: () => void; reject: (err: Error) => void };

function createCallbacks(): {
  cb: Callbacks;
  onX402Verify: () => void;
  onX402Settle: (r: { amount: string; network: string }) => void;
  onMPPSettle: () => void;
  onCapture: (key: string, result: CaptureResponse) => void;
} {
  let settleWaiter: Waiter | null = null;
  const captureWaiters = new Map<string, Waiter>();

  const cb: Callbacks = {
    x402VerifyCount: 0,
    x402SettleCount: 0,
    x402SettleRecords: [],
    mppSettleCount: 0,
    captures: new Map(),

    awaitX402Settle() {
      if (cb.x402SettleCount > 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        settleWaiter = { resolve, reject };
        setTimeout(() => reject(new Error("x402 settle timeout")), 5000);
      });
    },

    awaitCapture(operationKey: string) {
      if (cb.captures.has(operationKey)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        captureWaiters.set(operationKey, { resolve, reject });
        setTimeout(
          () => reject(new Error(`capture timeout: ${operationKey}`)),
          5000,
        );
      });
    },

    reset() {
      cb.x402VerifyCount = 0;
      cb.x402SettleCount = 0;
      cb.x402SettleRecords = [];
      cb.mppSettleCount = 0;
      cb.captures.clear();
      if (settleWaiter) {
        settleWaiter.reject(new Error("cancelled by reset()"));
        settleWaiter = null;
      }
      for (const [key, waiter] of captureWaiters) {
        waiter.reject(new Error(`awaitCapture(${key}) cancelled by reset()`));
      }
      captureWaiters.clear();
    },
  };

  return {
    cb,
    onX402Verify: () => {
      cb.x402VerifyCount++;
    },
    onX402Settle: (r) => {
      cb.x402SettleCount++;
      cb.x402SettleRecords.push({
        requirementsAmount: r.amount,
        network: r.network,
      });
      // settleWaiter is resolved in onCapture, not here —
      // awaitX402Settle must wait for both settlement AND
      // capture to complete before the test proceeds.
    },
    onMPPSettle: () => {
      cb.mppSettleCount++;
    },
    onCapture: (key, result) => {
      cb.captures.set(key, result);
      if (cb.x402SettleCount > 0 && settleWaiter) {
        settleWaiter.resolve();
        settleWaiter = null;
      }
      const waiter = captureWaiters.get(key);
      if (waiter) {
        captureWaiters.delete(key);
        waiter.resolve();
      }
    },
  };
}

function requireCapture(cb: Callbacks, operationKey: string): CaptureResponse {
  const cap = cb.captures.get(operationKey);
  if (!cap) throw new Error(`no capture recorded for ${operationKey}`);
  return cap;
}

// -- Test suite --

await t.test("nginx sidecar integration", async (t) => {
  const nginxOutputDir = join(TMP_DIR, "nginx");

  await configureApp();

  const { cb, onX402Verify, onX402Settle, onMPPSettle, onCapture } =
    createCallbacks();

  // -- Setup --

  await rm(TMP_DIR, { recursive: true, force: true });
  const confPath = await generateNginxConfig(nginxOutputDir);

  const upstreamApp = createMockUpstream();
  const upstreamServer = serve({
    fetch: upstreamApp.fetch,
    port: UPSTREAM_PORT,
  });

  // WebSocket upgrade handler on the same HTTP server. The nginx
  // WebSocket relay connects via ws:// to the upstream, which
  // triggers an HTTP upgrade on this server.
  const WS_GUID = "258EAFA5-E914-47DA-95CA-5AB5DC65C735";
  (upstreamServer as import("node:http").Server).on(
    "upgrade",
    (req, socket) => {
      if (req.url !== "/v1/ws/chat") {
        socket.destroy();
        return;
      }
      const key = req.headers["sec-websocket-key"] ?? "";
      const accept = createHash("sha1")
        .update(key + WS_GUID)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          "\r\n",
      );
      // Send a text frame with usage data after a short delay,
      // then close. WebSocket frame format: 0x81 = final text,
      // length byte (no mask for server→client).
      setTimeout(() => {
        const payload = JSON.stringify({
          usage: { total_tokens: 25 },
        });
        const buf = Buffer.alloc(2 + payload.length);
        buf[0] = 0x81; // FIN + text opcode
        buf[1] = payload.length; // payload length (< 126)
        buf.write(payload, 2);
        socket.write(buf);

        // Send close frame: 0x88, length 2, status 1000
        const close = Buffer.alloc(4);
        close[0] = 0x88;
        close[1] = 2;
        close.writeUInt16BE(1000, 2);
        socket.write(close);
      }, 50);
    },
  );

  const spec = await loadSpec(SPEC_PATH);
  const { app: sidecarApp } = createApp({
    spec,
    baseURL: NGINX_BASE,
    supportedVersions: { x402v1: true, x402v2: true },
    x402Handlers: [
      createTestFacilitatorHandler({
        payTo: "test-receiver",
        amountPolicy: (settle, signed) => settle <= signed,
        onVerify: onX402Verify,
        onSettle: onX402Settle,
      }),
    ],
    mppMethodHandlers: [createTestMPPHandler({ onSettle: onMPPSettle })],
    onCapture,
  });
  const sidecarServer = serve({ fetch: sidecarApp.fetch, port: SIDECAR_PORT });

  await waitForHealth(`http://127.0.0.1:${UPSTREAM_PORT}/health`);

  const nginx = $`${OPENRESTY_BIN} -c ${confPath}`;
  const nginxExit = nginx.then(
    () => {
      throw new Error("openresty exited before becoming healthy");
    },
    (cause: unknown) => {
      throw new Error(`openresty exited unexpectedly: ${String(cause)}`);
    },
  );

  await Promise.race([waitForHealth(`${NGINX_BASE}/health`), nginxExit]);

  t.teardown(async () => {
    const pidPath = join(nginxOutputDir, "nginx.pid");
    if (existsSync(pidPath)) {
      await $`kill $(cat ${pidPath})`.nothrow();
    }
    void nginx.nothrow(true);
    await nginx.kill().catch(() => {
      // expected if already stopped
    });
    sidecarServer?.close();
    upstreamServer?.close();
  });

  // -- Fetch wrappers --

  const x402Fetch = wrap(fetch, {
    handlers: [
      client.adaptPaymentHandlerV1ToV2(
        createTestPaymentHandler(),
        normalizeNetworkId,
      ),
    ],
    retryCount: 0,
  });

  const mppFetch = wrap(fetch, {
    handlers: [],
    mppHandlers: [createTestMPPPaymentHandler()],
    retryCount: 0,
  });

  // -- Unpaid routes --

  await t.test("unpaid GET /health returns 200", async (t) => {
    cb.reset();
    const res = await fetch(`${NGINX_BASE}/health`);
    t.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    t.equal(body.status, "ok");
    t.equal(cb.captures.size, 0, "unpaid route must not produce captures");
    t.equal(cb.x402VerifyCount, 0, "unpaid route must not trigger x402");
    t.end();
  });

  await t.test("unpaid GET /v1/data returns 200", async (t) => {
    cb.reset();
    const res = await fetch(`${NGINX_BASE}/v1/data`);
    t.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[] };
    t.ok(Array.isArray(body.items));
    t.equal(cb.captures.size, 0, "unpaid route must not produce captures");
    t.end();
  });

  // -- One-phase: capture-only, charges upfront --

  await t.test("one-phase images: 402 without payment", async (t) => {
    const res = await fetch(`${NGINX_BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cat" }),
    });
    t.equal(res.status, 402);
    t.end();
  });

  await t.test(
    "one-phase images: x402 settle at access, capture at log",
    async (t) => {
      cb.reset();
      const res = await x402Fetch(`${NGINX_BASE}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "a cat" }),
      });
      t.equal(res.status, 200);

      // One-phase settles at access time, not deferred to log.
      t.ok(
        cb.x402SettleCount > 0,
        "settle must fire at access time for one-phase",
      );

      const body = (await res.json()) as { data: unknown[] };
      t.ok(Array.isArray(body.data));

      // Log phase still fires for capture telemetry.
      await cb.awaitCapture("POST /v1/images/generations");
      const cap = requireCapture(cb, "POST /v1/images/generations");
      t.equal(cap.captured, true);
      t.equal(cap.amount.usdc, "1");
      t.end();
    },
  );

  // -- Two-phase: verify at access, settle at log --

  await t.test("paid endpoint without payment returns 402", async (t) => {
    const res = await fetch(`${NGINX_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
    });
    t.equal(res.status, 402);
    const body = (await res.json()) as { accepts?: unknown };
    t.ok(body.accepts !== undefined, "402 body must include accepts");
    t.end();
  });

  await t.test(
    "x402 JSON: verify at access, settle at log, correct capture",
    async (t) => {
      cb.reset();
      const res = await x402Fetch(`${NGINX_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
      });

      t.equal(res.status, 200);
      t.ok(cb.x402VerifyCount > 0, "verify must fire at access time");
      t.equal(cb.x402SettleCount, 0, "settle must not fire before log phase");

      const body = (await res.json()) as {
        object: string;
        usage: { total_tokens: number };
      };
      t.equal(body.object, "chat.completion");
      t.equal(body.usage.total_tokens, 30);

      await cb.awaitX402Settle();
      t.ok(cb.x402SettleCount > 0, "settle must fire in log phase");

      // The gateway passes the captured amount (30) to the
      // facilitator. Authorize was 500 (hold ceiling).
      t.equal(cb.x402SettleRecords.length, 1);
      t.equal(cb.x402SettleRecords[0]?.requirementsAmount, "30");

      const cap = requireCapture(cb, "POST /v1/chat/completions");
      t.equal(cap.captured, true);
      t.equal(cap.amount.usdc, "30");
      t.end();
    },
  );

  await t.test(
    "x402 SSE: verify at access, settle at log, correct capture",
    async (t) => {
      cb.reset();
      const res = await x402Fetch(`${NGINX_BASE}/v1/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", stream: true }),
      });

      t.equal(res.status, 200);
      t.ok(cb.x402VerifyCount > 0, "verify must fire at access time");

      const ct = res.headers.get("content-type") ?? "";
      t.ok(ct.includes("text/event-stream"));
      const text = await res.text();
      t.ok(text.includes("data:"), "SSE body must contain data frames");

      await cb.awaitX402Settle();
      t.ok(cb.x402SettleCount > 0, "settle must fire in log phase");

      const cap = requireCapture(cb, "POST /v1/chat/stream");
      t.equal(cap.captured, true);
      t.equal(cap.amount.usdc, "30");
      t.end();
    },
  );

  await t.test("x402 POST /v1/data: correct capture amount", async (t) => {
    cb.reset();
    const res = await x402Fetch(`${NGINX_BASE}/v1/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    t.equal(res.status, 200);
    t.ok(cb.x402VerifyCount > 0, "verify must fire at access time");

    const body = (await res.json()) as { created: boolean };
    t.equal(body.created, true);

    await cb.awaitX402Settle();

    const lastSettle = cb.x402SettleRecords[cb.x402SettleRecords.length - 1];
    t.equal(lastSettle?.requirementsAmount, "5");

    const cap = requireCapture(cb, "POST /v1/data");
    t.equal(cap.amount.usdc, "5");
    t.end();
  });

  // -- MPP: settles at access --

  await t.test(
    "MPP payment flow: 402 -> credential -> settle -> 200",
    async (t) => {
      cb.reset();
      const res = await mppFetch(`${NGINX_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
      });

      t.equal(res.status, 200);
      t.ok(cb.mppSettleCount > 0, "MPP settle must fire");

      const body = (await res.json()) as { object: string };
      t.equal(body.object, "chat.completion");

      await cb.awaitCapture("POST /v1/chat/completions");
      const cap = requireCapture(cb, "POST /v1/chat/completions");
      t.equal(cap.captured, true);
      t.equal(cap.amount.usdc, "30");
      t.end();
    },
  );

  // -- Capture failure: upstream returns unexpected shape --

  await t.test("capture failure returns non-2xx so Lua retries", async (t) => {
    // /v1/unstable returns a body without the `usage` field that
    // the capture expression references. The sidecar's
    // handleResponse throws (JSONPath resolves to 0 values),
    // and returns 422. Lua sees non-2xx and schedules a retry.
    // From the client's perspective the request succeeds (the
    // upstream response already went through), but the capture
    // callback should NOT record a successful capture.
    cb.reset();
    const res = await x402Fetch(`${NGINX_BASE}/v1/unstable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "test" }),
    });
    t.equal(res.status, 200, "upstream response still reaches the client");
    t.ok(cb.x402VerifyCount > 0, "verify must fire at access time");

    // Give the log phase time to fire and fail.
    await new Promise((r) => setTimeout(r, 1000));

    // The capture should NOT be recorded — handleResponse threw
    // before onCapture could fire.
    t.equal(
      cb.captures.has("POST /v1/unstable"),
      false,
      "capture must not be recorded when capture expression fails",
    );
    t.end();
  });

  // -- Payment rejection: invalid payment header --

  await t.test("invalid payment header returns 402, not 502", async (t) => {
    // A garbled payment header should result in a 402 challenge
    // (the sidecar didn't recognize the payment), not a 502
    // (which would mean the sidecar itself failed).
    const res = await fetch(`${NGINX_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "not-valid-base64!!!",
      },
      body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
    });
    t.equal(res.status, 402, "invalid payment must produce 402, not 502");
    t.end();
  });

  // -- Match filter routing --

  await t.test(
    "match filter routes to the correct rule based on request body",
    async (t) => {
      // /v1/models has two rules:
      //   1. model == "expensive" → capture * 10
      //   2. catch-all → capture * 1
      // With total_tokens=20 from the mock upstream:
      //   "expensive" → 200, catch-all → 20.

      // Test the catch-all (default model).
      cb.reset();
      const defaultRes = await x402Fetch(`${NGINX_BASE}/v1/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "cheap" }),
      });
      t.equal(defaultRes.status, 200);
      await cb.awaitX402Settle();
      const defaultSettle =
        cb.x402SettleRecords[cb.x402SettleRecords.length - 1];
      t.equal(
        defaultSettle?.requirementsAmount,
        "20",
        "catch-all rule: 20 * 1 = 20",
      );

      // Test the expensive model.
      cb.reset();
      const expensiveRes = await x402Fetch(`${NGINX_BASE}/v1/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "expensive" }),
      });
      t.equal(expensiveRes.status, 200);
      await cb.awaitX402Settle();
      const expensiveSettle =
        cb.x402SettleRecords[cb.x402SettleRecords.length - 1];
      t.equal(
        expensiveSettle?.requirementsAmount,
        "200",
        "expensive rule: 20 * 10 = 200",
      );
      t.end();
    },
  );

  // -- Rate cascading --

  await t.test(
    "path-level rate override produces correct settlement amount",
    async (t) => {
      // /v1/premium has rates: { usdc: 5 } at the operation level,
      // overriding the document-level usdc: 1. Capture evaluates
      // to 10 (total_tokens), multiplied by rate 5 = 50.
      cb.reset();
      const res = await x402Fetch(`${NGINX_BASE}/v1/premium`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "gold" }),
      });
      t.equal(res.status, 200);
      await cb.awaitX402Settle();
      const cap = requireCapture(cb, "POST /v1/premium");
      t.equal(cap.amount.usdc, "50", "capture 10 * rate 5 = 50");
      t.end();
    },
  );

  // -- coalesce and jsonSize in authorize --

  await t.test(
    "coalesce and jsonSize produce correct authorize amount",
    async (t) => {
      // /v1/estimate authorize:
      //   jsonSize($.request.body.messages) / 4
      //   + coalesce($.request.body.max_tokens, 100)
      //
      // With messages: ["hello"] → jsonSize = 9 → 9/4 = 2.25
      // No max_tokens → coalesce fallback = 100
      // Total coefficient = 102.25 → ceil(102.25 * 1) = 103
      //
      // The 402 response should advertise this amount. We verify
      // by checking the 402 body's accepts[0].amount.
      // Extract the amount from the v2 PAYMENT-REQUIRED header
      // (base64-encoded JSON with an `accepts` array).
      function extractV2Amount(res: Response): string | undefined {
        const header = res.headers.get("PAYMENT-REQUIRED");
        if (!header) return undefined;
        const parsed = JSON.parse(atob(header)) as {
          accepts?: { amount: string }[];
        };
        return parsed.accepts?.[0]?.amount;
      }

      const res = await fetch(`${NGINX_BASE}/v1/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: ["hello"] }),
      });
      t.equal(res.status, 402);
      t.equal(
        extractV2Amount(res),
        "103",
        "jsonSize(['hello'])=9, 9/4=2.25, coalesce fallback=100, ceil(102.25)=103",
      );

      // Now with max_tokens provided (overrides coalesce fallback).
      // messages: ["hi"] → jsonSize = 6 → 6/4 = 1.5
      // max_tokens: 50 → coalesce resolves to 50
      // Total = 51.5 → ceil = 52
      const res2 = await fetch(`${NGINX_BASE}/v1/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: ["hi"], max_tokens: 50 }),
      });
      t.equal(res2.status, 402);
      t.equal(
        extractV2Amount(res2),
        "52",
        "jsonSize(['hi'])=6, 6/4=1.5, max_tokens=50, ceil(51.5)=52",
      );
      t.end();
    },
  );

  // -- WebSocket transport --

  await t.test("WebSocket without payment returns 402", async (t) => {
    const res = await fetch(`${NGINX_BASE}/v1/ws/chat`);
    t.equal(res.status, 402, "WebSocket endpoint must require payment");
    t.end();
  });

  await t.test(
    "WebSocket: verify at access, frame capture, settle at log",
    async (t) => {
      cb.reset();

      // Build a v2 payment header for the authorize amount (500).
      // The access_by_lua block verifies this before the WebSocket
      // content_by_lua_block takes over.
      const paymentHeader = btoa(
        JSON.stringify({
          x402Version: 2,
          resource: { url: `${NGINX_BASE}/v1/ws/chat` },
          accepted: {
            scheme: TEST_SCHEME,
            network: TEST_NETWORK,
            amount: "500",
            asset: TEST_ASSET,
            payTo: "test-receiver",
            maxTimeoutSeconds: 300,
          },
          payload: {
            testId: generateTestId(),
            amount: "500",
            timestamp: Date.now(),
          },
        }),
      );

      const ws = new WebSocket(`ws://127.0.0.1:${NGINX_PORT}/v1/ws/chat`, {
        headers: { "PAYMENT-SIGNATURE": paymentHeader },
      } as object);

      const frames: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("WebSocket timeout")),
          5000,
        );
        ws.onmessage = (event) => {
          frames.push(String(event.data));
        };
        ws.onclose = () => {
          clearTimeout(timeout);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection error"));
        };
      });

      t.ok(frames.length > 0, "must receive at least one frame");
      const parsed = JSON.parse(frames[0] ?? "{}") as {
        usage?: { total_tokens?: number };
      };
      t.equal(
        parsed.usage?.total_tokens,
        25,
        "frame must contain usage.total_tokens from mock upstream",
      );

      // Wait for the async log-phase capture (timer-deferred).
      await cb.awaitCapture("GET /v1/ws/chat");
      const cap = requireCapture(cb, "GET /v1/ws/chat");
      t.equal(cap.captured, true);
      t.equal(cap.amount.usdc, "25", "capture from WebSocket frame");
      t.end();
    },
  );

  // -- Multi-value headers --

  await t.test(
    "multi-value headers flow through nginx to sidecar correctly",
    async (t) => {
      // Send a request with a repeated custom header. The Lua
      // gateway's array_aware() should preserve both values as an
      // array. The sidecar normalizes them to a comma-joined
      // string. We verify the request reaches the upstream (200)
      // and the payment flow completes — if header handling is
      // broken, the sidecar would reject the payload.
      cb.reset();
      const res = await x402Fetch(`${NGINX_BASE}/v1/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Custom": "value1",
          // Note: fetch() merges duplicate headers per spec.
          // Use a single comma-separated value to simulate what
          // nginx would see from a client sending two headers.
          "X-Multi": "a, b",
        },
        body: JSON.stringify({ name: "multi-header-test" }),
      });
      t.equal(res.status, 200);
      await cb.awaitX402Settle();
      t.ok(cb.x402SettleCount > 0, "payment flow must complete");
      t.end();
    },
  );

  t.end();
});
