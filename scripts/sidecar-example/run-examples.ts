import { spinner, echo, $, sleep } from "zx";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { configureApp } from "@faremeter/logs";
import { loadSpec } from "@faremeter/middleware-openapi";
import type { CaptureResponse } from "@faremeter/middleware-openapi";
import {
  createTestFacilitatorHandler,
  createTestMPPHandler,
} from "@faremeter/test-harness";
import { createApp } from "@faremeter/sidecar/app";
import { runTestFlows } from "./test-flows.js";

$.verbose = true;

const metaDir = import.meta.dirname;
if (!metaDir) {
  throw new Error("import.meta.dirname is not available");
}
const REPO_ROOT = resolve(metaDir, "../..");
const SCRIPTS_DIR = resolve(metaDir, "..");
const SPEC_PATH = resolve(metaDir, "openapi.yaml");
const SIDECAR_PORT = 4002;
const UPSTREAM_PORT = 4100;
const OPENRESTY_BIN = "/opt/homebrew/bin/openresty";

function checkOpenResty() {
  if (!existsSync(OPENRESTY_BIN)) {
    echo(
      `error: openresty not found at ${OPENRESTY_BIN}\n` +
        "Install with: brew install openresty/brew/openresty",
    );
    process.exit(1);
  }
}

async function generateNginxConfig(outputDir: string) {
  await mkdir(outputDir, { recursive: true });

  await $`pnpm tsx ${join(REPO_ROOT, "packages/gateway-nginx/src/cli.ts")} \
    --spec ${SPEC_PATH} \
    --sidecar http://127.0.0.1:${SIDECAR_PORT} \
    --upstream http://127.0.0.1:${UPSTREAM_PORT} \
    --output ${outputDir}`;

  const confPath = join(outputDir, "nginx.conf");
  let conf = await readFile(confPath, "utf-8");

  const pidPath = join(outputDir, "nginx.pid");
  const errorLogPath = join(outputDir, "error.log");
  conf =
    `daemon off;\n` +
    `pid ${pidPath};\n` +
    `error_log ${errorLogPath} info;\n\n` +
    conf;

  conf = conf.replace(
    /lua_package_path "[^"]*";/,
    `lua_package_path "${join(outputDir, "lua")}/?.lua;;";`,
  );

  const catchAll = [
    "",
    "    location / {",
    "        proxy_pass http://backend;",
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Real-IP $remote_addr;",
    "    }",
  ].join("\n");

  const serverCloseIdx = conf.lastIndexOf("  }");
  if (serverCloseIdx !== -1) {
    conf =
      conf.slice(0, serverCloseIdx) +
      catchAll +
      "\n" +
      conf.slice(serverCloseIdx);
  }

  await writeFile(confPath, conf);
}

async function checkLuaRestyHTTP() {
  const opmBin = OPENRESTY_BIN.replace("openresty", "opm");
  const result =
    await $`${opmBin} list 2>/dev/null | grep lua-resty-http`.nothrow();
  if (result.exitCode !== 0) {
    echo(
      "error: lua-resty-http not found\n" +
        "Install with: opm install ledgetech/lua-resty-http",
    );
    process.exit(1);
  }
}

export type CaptureResult = CaptureResponse;

export type HandlerCallbacks = {
  x402VerifyCount: number;
  x402SettleCount: number;
  mppSettleCount: number;
  captures: Map<string, CaptureResult>;
  awaitX402Settle(): Promise<void>;
  reset(): void;
};

function createCallbacks() {
  let x402SettleResolve: (() => void) | null = null;
  let x402SettlePromise: Promise<void> | null = null;

  const cb: HandlerCallbacks = {
    x402VerifyCount: 0,
    x402SettleCount: 0,
    mppSettleCount: 0,
    captures: new Map(),

    awaitX402Settle() {
      if (cb.x402SettleCount > 0) return Promise.resolve();
      x402SettlePromise ??= new Promise((r) => {
        x402SettleResolve = r;
      });
      return Promise.race([
        x402SettlePromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("x402 settle timeout")), 2000),
        ),
      ]);
    },

    reset() {
      cb.x402VerifyCount = 0;
      cb.x402SettleCount = 0;
      cb.mppSettleCount = 0;
      cb.captures.clear();
      x402SettleResolve = null;
      x402SettlePromise = null;
    },
  };

  function onX402Verify() {
    cb.x402VerifyCount++;
  }

  function onX402Settle() {
    cb.x402SettleCount++;
  }

  function onMPPSettle() {
    cb.mppSettleCount++;
  }

  function onCapture(operationKey: string, result: CaptureResult) {
    cb.captures.set(operationKey, result);
    if (cb.x402SettleCount > 0) {
      x402SettleResolve?.();
    }
  }

  return { callbacks: cb, onX402Verify, onX402Settle, onMPPSettle, onCapture };
}

async function startSidecar(cbs: {
  onX402Verify: () => void;
  onX402Settle: () => void;
  onMPPSettle: () => void;
  onCapture: (operationKey: string, result: CaptureResult) => void;
}) {
  await configureApp();

  const spec = await loadSpec(SPEC_PATH);
  const { app } = createApp({
    spec,
    baseURL: "http://127.0.0.1:8080",
    x402Handlers: [
      createTestFacilitatorHandler({
        payTo: "test-receiver",
        onVerify: cbs.onX402Verify,
        onSettle: cbs.onX402Settle,
      }),
    ],
    mppMethodHandlers: [
      createTestMPPHandler({
        onSettle: cbs.onMPPSettle,
      }),
    ],
    onCapture: cbs.onCapture,
  });

  const server = serve({ fetch: app.fetch, port: SIDECAR_PORT });
  echo(`sidecar listening on port ${SIDECAR_PORT}`);
  return server;
}

async function main() {
  checkOpenResty();

  const tmpDir = join(REPO_ROOT, "tmp", "sidecar-test");
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  const nginxOutputDir = join(tmpDir, "nginx");

  await checkLuaRestyHTTP();

  echo("Generating nginx config...");
  await generateNginxConfig(nginxOutputDir);

  const confPath = join(nginxOutputDir, "nginx.conf");

  const { callbacks, onX402Verify, onX402Settle, onMPPSettle, onCapture } =
    createCallbacks();

  echo("Starting sidecar...");
  const sidecar = await startSidecar({
    onX402Verify,
    onX402Settle,
    onMPPSettle,
    onCapture,
  });

  echo("Starting mock upstream...");
  const upstream = $`cd ${SCRIPTS_DIR} && pnpm tsx sidecar-example/mock-upstream.ts`;

  await spinner("Waiting for upstream to start...", () => sleep(2000));

  echo("Starting OpenResty...");
  const nginx = $`${OPENRESTY_BIN} -c ${confPath}`;

  await spinner("Waiting for OpenResty to start...", () => sleep(1000));

  let success = false;
  try {
    success = await runTestFlows(callbacks);
  } catch (e) {
    echo(`error running test flows: ${e}`);
    success = false;
  } finally {
    echo("Tearing down processes...");

    sidecar.close();

    const pidPath = join(nginxOutputDir, "nginx.pid");
    if (existsSync(pidPath)) {
      await $`kill $(cat ${pidPath})`.nothrow();
    }
    void nginx.nothrow(true);
    await nginx.kill().catch(() => {
      /* expected to fail if already stopped */
    });

    void upstream.nothrow(true);
    await upstream.kill().catch(() => {
      /* expected to fail if already stopped */
    });

    echo("Cleanup complete.");
  }

  process.exit(success ? 0 : 1);
}

main().catch((e: unknown) => {
  echo(`fatal: ${e}`);
  process.exit(1);
});
