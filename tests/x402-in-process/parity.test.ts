#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  TestHarness,
  createTestFacilitatorHandler,
  createTestPaymentHandler,
  accepts,
  TEST_ASSET,
  TEST_NETWORK,
} from "@faremeter/test-harness";
import type { ResourceContext } from "@faremeter/test-harness";
import type { ResourcePricing } from "@faremeter/types/pricing";

const pricing: ResourcePricing[] = [
  {
    amount: "100",
    asset: TEST_ASSET,
    recipient: "test-receiver",
    network: TEST_NETWORK,
  },
];

await t.test(
  "in-process and HTTP modes produce equivalent results",
  async (t) => {
    await t.test("settle-only mode", async (t) => {
      let httpContext: ResourceContext | undefined;
      let inProcessContext: ResourceContext | undefined;

      const httpHarness = new TestHarness({
        settleMode: "settle-only",
        accepts: [accepts()],
        facilitatorHandlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        clientHandlers: [createTestPaymentHandler()],
      });
      httpHarness.setResourceHandler((ctx) => {
        httpContext = ctx;
        return { status: 200, body: { mode: "http" } };
      });

      const inProcessHarness = new TestHarness({
        settleMode: "settle-only",
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        pricing,
        clientHandlers: [createTestPaymentHandler()],
      });
      inProcessHarness.setResourceHandler((ctx) => {
        inProcessContext = ctx;
        return { status: 200, body: { mode: "in-process" } };
      });

      const httpFetch = httpHarness.createFetch();
      const httpResponse = await httpFetch("/test-resource");

      const inProcessFetch = inProcessHarness.createFetch();
      const inProcessResponse = await inProcessFetch("/test-resource");

      t.equal(httpResponse.status, 200, "HTTP mode succeeds");
      t.equal(inProcessResponse.status, 200, "in-process mode succeeds");

      t.ok(httpContext, "HTTP resource handler was called");
      t.ok(inProcessContext, "in-process resource handler was called");

      if (httpContext && inProcessContext) {
        t.equal(
          httpContext.protocolVersion,
          inProcessContext.protocolVersion,
          "protocol versions match",
        );
        t.equal(
          httpContext.settleResponse.success,
          inProcessContext.settleResponse.success,
          "settlement success matches",
        );
        t.equal(
          httpContext.paymentRequirements.scheme,
          inProcessContext.paymentRequirements.scheme,
          "payment scheme matches",
        );
        t.equal(
          httpContext.paymentRequirements.network,
          inProcessContext.paymentRequirements.network,
          "payment network matches",
        );
      }

      t.end();
    });

    await t.test("verify-then-settle mode", async (t) => {
      let httpContext: ResourceContext | undefined;
      let inProcessContext: ResourceContext | undefined;

      const httpHarness = new TestHarness({
        settleMode: "verify-then-settle",
        accepts: [accepts()],
        facilitatorHandlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        clientHandlers: [createTestPaymentHandler()],
      });
      httpHarness.setResourceHandler((ctx) => {
        httpContext = ctx;
        return { status: 200, body: { mode: "http" } };
      });

      const inProcessHarness = new TestHarness({
        settleMode: "verify-then-settle",
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        pricing,
        clientHandlers: [createTestPaymentHandler()],
      });
      inProcessHarness.setResourceHandler((ctx) => {
        inProcessContext = ctx;
        return { status: 200, body: { mode: "in-process" } };
      });

      const httpFetch = httpHarness.createFetch();
      const httpResponse = await httpFetch("/test-resource");

      const inProcessFetch = inProcessHarness.createFetch();
      const inProcessResponse = await inProcessFetch("/test-resource");

      t.equal(httpResponse.status, 200, "HTTP mode succeeds");
      t.equal(inProcessResponse.status, 200, "in-process mode succeeds");

      t.ok(httpContext, "HTTP resource handler was called");
      t.ok(inProcessContext, "in-process resource handler was called");

      if (httpContext && inProcessContext) {
        t.equal(
          httpContext.protocolVersion,
          inProcessContext.protocolVersion,
          "protocol versions match",
        );
        t.equal(
          httpContext.settleResponse.success,
          inProcessContext.settleResponse.success,
          "settlement success matches",
        );
      }

      t.end();
    });
  },
);
