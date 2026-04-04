import { echo } from "zx";
import { wrap } from "@faremeter/fetch";
import {
  createTestPaymentHandler,
  createTestMPPPaymentHandler,
} from "@faremeter/test-harness";
import { client } from "@faremeter/types";
import { normalizeNetworkId } from "@faremeter/info";
import type { HandlerCallbacks } from "./run-examples.js";

const NGINX_BASE = "http://127.0.0.1:8080";

type TestResult = {
  name: string;
  passed: boolean;
  error?: string;
};

type JSONObject = Record<string, unknown>;

async function json(res: Response): Promise<JSONObject> {
  return (await res.json()) as JSONObject;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

function test(
  name: string,
  fn: () => Promise<void>,
): () => Promise<TestResult> {
  return async () => {
    try {
      await fn();
      echo(`  PASS: ${name}`);
      return { name, passed: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      echo(`  FAIL: ${name} -- ${error}`);
      return { name, passed: false, error };
    }
  };
}

export async function runTestFlows(cb: HandlerCallbacks): Promise<boolean> {
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

  const tests = [
    // -- Negative tests: raw fetch to paid endpoints must return 402 --

    test("paid endpoint without payment returns 402", async () => {
      const res = await fetch(`${NGINX_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
      });
      assert(res.status === 402, `expected 402, got ${res.status}`);
      const body = await json(res);
      assert(body.accepts !== undefined, "expected accepts in 402 body");
      const wwwAuth = res.headers.get("WWW-Authenticate");
      assert(
        wwwAuth !== null,
        "expected WWW-Authenticate header (MPP challenge)",
      );
    }),

    test("paid POST /v1/data without payment returns 402", async () => {
      const res = await fetch(`${NGINX_BASE}/v1/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });
      assert(res.status === 402, `expected 402, got ${res.status}`);
      const body = await json(res);
      assert(body.accepts !== undefined, "expected accepts in 402 body");
    }),

    // -- Unpaid routes: no pricing, pass through --

    test("unpaid GET /health returns 200", async () => {
      const res = await fetch(`${NGINX_BASE}/health`);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await json(res);
      assert(body.status === "ok", `expected status=ok, got ${body.status}`);
    }),

    test("unpaid GET /v1/data returns 200", async () => {
      const res = await fetch(`${NGINX_BASE}/v1/data`);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await json(res);
      assert(Array.isArray(body.items), "expected items array");
    }),

    // -- One-phase: no authorize expression, passes through at /request --

    test("one-phase images passes through without payment", async () => {
      const res = await fetch(`${NGINX_BASE}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "a cat" }),
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await json(res);
      assert(Array.isArray(body.data), "expected data array");
    }),

    // -- x402 two-phase: verify at access, settle at log --

    test("x402 JSON: verify at access, settle at log, correct capture", async () => {
      cb.reset();

      const res = await x402Fetch(`${NGINX_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
      });

      assert(res.status === 200, `expected 200, got ${res.status}`);

      // Verify happened at access time (before response returned)
      assert(cb.x402VerifyCount > 0, "verify was never called at access time");
      // Settle has NOT happened yet (it's in the async log phase)
      assert(
        cb.x402SettleCount === 0,
        `settle fired prematurely (count=${cb.x402SettleCount})`,
      );

      const body = await json(res);
      assert(
        body.object === "chat.completion",
        `expected chat.completion, got ${body.object}`,
      );
      const usage = body.usage as JSONObject | undefined;
      assert(usage !== undefined, "expected usage in response");
      assert(
        usage.total_tokens === 30,
        `expected total_tokens=30, got ${usage.total_tokens}`,
      );

      // Wait for async log phase to settle
      await cb.awaitX402Settle();
      assert(cb.x402SettleCount > 0, "settle was never called in log phase");

      // Verify capture expression evaluated correctly:
      // capture: "$.response.body.usage.total_tokens" = 30, rate usdc: 1 → amount "30"
      const chatCapture = cb.captures.get("POST /v1/chat/completions");
      assert(chatCapture !== undefined, "no capture for chat/completions");
      assert(chatCapture.captured, "capture should be true");
      assert(
        chatCapture.amount.usdc === "30",
        `expected captured usdc=30, got ${chatCapture.amount.usdc}`,
      );
    }),

    test("x402 SSE: verify at access, settle at log, correct capture", async () => {
      cb.reset();

      const res = await x402Fetch(`${NGINX_BASE}/v1/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", stream: true }),
      });

      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(cb.x402VerifyCount > 0, "verify was never called at access time");

      const ct = res.headers.get("content-type") ?? "";
      assert(
        ct.includes("text/event-stream"),
        `expected SSE content-type, got ${ct}`,
      );
      const text = await res.text();
      assert(text.includes("data:"), "expected SSE data frames");

      await cb.awaitX402Settle();
      assert(cb.x402SettleCount > 0, "settle was never called in log phase");

      // SSE body filter should extract total_tokens=30 from final event
      const sseCapture = cb.captures.get("POST /v1/chat/stream");
      assert(sseCapture !== undefined, "no capture for chat/stream");
      assert(sseCapture.captured, "capture should be true");
      assert(
        sseCapture.amount.usdc === "30",
        `expected captured usdc=30, got ${sseCapture.amount.usdc}`,
      );
    }),

    test("x402 POST /v1/data: correct capture amount", async () => {
      cb.reset();

      const res = await x402Fetch(`${NGINX_BASE}/v1/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });

      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(cb.x402VerifyCount > 0, "verify was never called at access time");

      const body = await json(res);
      assert(
        body.created === true,
        `expected created=true, got ${body.created}`,
      );

      await cb.awaitX402Settle();

      // capture: "$.response.body.usage.count" = 5, rate usdc: 1 → amount "5"
      const dataCapture = cb.captures.get("POST /v1/data");
      assert(dataCapture !== undefined, "no capture for /v1/data");
      assert(
        dataCapture.amount.usdc === "5",
        `expected captured usdc=5, got ${dataCapture.amount.usdc}`,
      );
    }),

    // -- MPP: settles at access (no verify phase in MPP) --

    test("MPP payment flow: 402 -> credential -> settle -> 200", async () => {
      cb.reset();

      const res = await mppFetch(`${NGINX_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5", messages: [] }),
      });

      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(cb.mppSettleCount > 0, "MPP settle was never called");

      const body = await json(res);
      assert(
        body.object === "chat.completion",
        `expected chat.completion, got ${body.object}`,
      );
    }),
  ];

  echo("Running sidecar integration test flows...\n");

  const results: TestResult[] = [];
  for (const t of tests) {
    results.push(await t());
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  echo(`\n${passed} passed, ${failed} failed out of ${results.length} tests`);

  return failed === 0;
}
