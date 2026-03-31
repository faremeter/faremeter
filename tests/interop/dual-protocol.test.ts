#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  TestHarness,
  createTestMPPHandler,
  createTestMPPPaymentHandler,
  createTestFacilitatorHandler,
  createTestPaymentHandler,
  TEST_NETWORK,
  TEST_ASSET,
} from "@faremeter/test-harness";
import type { ResourcePricing } from "@faremeter/types/pricing";

const pricing: ResourcePricing[] = [
  {
    amount: "100",
    asset: TEST_ASSET,
    recipient: "test-receiver",
    network: TEST_NETWORK,
  },
];

await t.test("dual-protocol client behavior", async (t) => {
  await t.test(
    "client with both handlers prefers MPP when server supports both",
    async (t) => {
      let capturedProtocol: string | number | undefined;

      const harness = new TestHarness({
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        mppMethodHandlers: [createTestMPPHandler()],
        pricing,
        clientHandlers: [createTestPaymentHandler()],
        mppClientHandlers: [createTestMPPPaymentHandler()],
        settleMode: "settle-only",
      });

      harness.setResourceHandler((ctx) => {
        capturedProtocol = ctx.protocolVersion;
        return { status: 200, body: { captured: true } };
      });

      const fetch = harness.createFetch();
      const response = await fetch("/test-resource");

      t.equal(response.status, 200, "payment should succeed");
      t.equal(
        capturedProtocol,
        "mpp",
        "should prefer MPP when both handlers are available",
      );

      t.end();
    },
  );

  await t.test(
    "client with only x402 handlers falls back to x402 on dual-protocol server",
    async (t) => {
      let capturedProtocol: string | number | undefined;

      const harness = new TestHarness({
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        mppMethodHandlers: [createTestMPPHandler()],
        pricing,
        clientHandlers: [createTestPaymentHandler()],
        settleMode: "settle-only",
      });

      harness.setResourceHandler((ctx) => {
        capturedProtocol = ctx.protocolVersion;
        return { status: 200, body: { captured: true } };
      });

      const fetch = harness.createFetch();
      const response = await fetch("/test-resource");

      t.equal(response.status, 200, "payment should succeed via x402");
      t.ok(
        capturedProtocol === 1 || capturedProtocol === 2,
        "should use x402 when no MPP client handlers are available",
      );

      t.end();
    },
  );

  await t.test(
    "client with only MPP handlers succeeds on dual-protocol server",
    async (t) => {
      let capturedProtocol: string | number | undefined;

      const harness = new TestHarness({
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        mppMethodHandlers: [createTestMPPHandler()],
        pricing,
        clientHandlers: [],
        mppClientHandlers: [createTestMPPPaymentHandler()],
        settleMode: "settle-only",
      });

      harness.setResourceHandler((ctx) => {
        capturedProtocol = ctx.protocolVersion;
        return { status: 200, body: { captured: true } };
      });

      const fetch = harness.createFetch();
      const response = await fetch("/test-resource");

      t.equal(response.status, 200, "payment should succeed via MPP");
      t.equal(capturedProtocol, "mpp", "should use MPP");

      t.end();
    },
  );

  await t.test(
    "402 response includes both x402 and MPP challenges",
    async (t) => {
      const harness = new TestHarness({
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        mppMethodHandlers: [createTestMPPHandler()],
        pricing,
        clientHandlers: [],
        settleMode: "settle-only",
      });

      const clientFetch = harness.createClientFetch();
      const response = await clientFetch("/test-resource");

      t.equal(response.status, 402, "should return 402");

      const wwwAuth = response.headers.get("WWW-Authenticate");
      t.ok(wwwAuth, "should have WWW-Authenticate header for MPP");

      const body = (await response.json()) as { accepts?: unknown[] };
      t.ok(body.accepts, "should have x402 accepts in body");
      t.ok(
        Array.isArray(body.accepts) && body.accepts.length > 0,
        "accepts should be non-empty",
      );

      t.end();
    },
  );

  t.end();
});
