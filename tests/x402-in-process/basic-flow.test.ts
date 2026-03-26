#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  TestHarness,
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

await t.test("in-process basic payment flow", async (t) => {
  await t.test("settle-only mode completes successfully", async (t) => {
    const harness = new TestHarness({
      x402Handlers: [createTestFacilitatorHandler({ payTo: "test-receiver" })],
      pricing,
      clientHandlers: [createTestPaymentHandler()],
      settleMode: "settle-only",
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200, "should complete payment flow");

    const body = (await response.json()) as { success: boolean };
    t.ok(body.success, "resource should return success");

    t.end();
  });

  await t.test("verify-then-settle mode completes successfully", async (t) => {
    const harness = new TestHarness({
      x402Handlers: [createTestFacilitatorHandler({ payTo: "test-receiver" })],
      pricing,
      clientHandlers: [createTestPaymentHandler()],
      settleMode: "verify-then-settle",
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200, "should complete payment flow");
    t.end();
  });

  await t.test("resource handler receives correct context", async (t) => {
    let capturedResource: string | undefined;
    let capturedProtocol: number | string | undefined;

    const harness = new TestHarness({
      x402Handlers: [createTestFacilitatorHandler({ payTo: "test-receiver" })],
      pricing,
      clientHandlers: [createTestPaymentHandler()],
      settleMode: "settle-only",
    });

    harness.setResourceHandler((ctx) => {
      capturedResource = ctx.resource;
      capturedProtocol = ctx.protocolVersion;
      return {
        status: 200,
        body: { captured: true },
      };
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200);
    t.ok(capturedResource, "resource handler should have been called");
    t.match(capturedResource, /test-resource/, "resource URL should match");
    t.equal(capturedProtocol, 1, "default protocol version should be v1");
    t.end();
  });

  await t.test("returns 402 when no payment header", async (t) => {
    const harness = new TestHarness({
      x402Handlers: [createTestFacilitatorHandler({ payTo: "test-receiver" })],
      pricing,
      clientHandlers: [createTestPaymentHandler()],
    });

    const clientFetch = harness.createClientFetch();
    const response = await clientFetch("/test-resource");

    t.equal(response.status, 402, "should return 402 without payment");

    const body = (await response.json()) as {
      x402Version: number;
      accepts: unknown[];
    };
    t.equal(body.x402Version, 1, "should return v1 response by default");
    t.ok(body.accepts.length > 0, "should include payment options");
    t.end();
  });

  await t.test("handler callbacks are invoked", async (t) => {
    let settleCalled = false;

    const harness = new TestHarness({
      x402Handlers: [
        createTestFacilitatorHandler({
          payTo: "test-receiver",
          onSettle: () => {
            settleCalled = true;
          },
        }),
      ],
      pricing,
      clientHandlers: [createTestPaymentHandler()],
      settleMode: "settle-only",
    });

    const fetch = harness.createFetch();
    await fetch("/test-resource");

    t.ok(settleCalled, "onSettle callback should have been invoked");
    t.end();
  });
});
