#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  TestHarness,
  createTestFacilitatorHandler,
  createTestPaymentHandler,
  accepts,
  createMPPResponseInterceptor,
  isResourceContextV2,
  createCaptureInterceptor,
  matchResource,
} from "@faremeter/test-harness";
import { base64url } from "@faremeter/types";

await t.test("MPP protocol flow", async (t) => {
  await t.test("end-to-end MPP successful flow (settle-only)", async (t) => {
    let facilitatorSettleCalled = false;

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({
          payTo: "test-receiver",
          onSettle: () => {
            facilitatorSettleCalled = true;
          },
        }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
    });

    let resourceHandlerCalled = false;
    harness.setResourceHandler(() => {
      resourceHandlerCalled = true;
      return { status: 200, body: { success: true } };
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200, "should complete successfully");
    t.ok(resourceHandlerCalled, "resource handler should have been called");
    t.ok(facilitatorSettleCalled, "facilitator settle should have been called");
    const body = await response.json();
    t.same(
      body,
      { success: true },
      "response body should match resource handler output",
    );

    t.end();
  });

  await t.test("MPP settle-only skips verify step", async (t) => {
    let verifyAttempted = false;

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "verify-then-settle",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({
          payTo: "test-receiver",
          onVerify: () => {
            verifyAttempted = true;
          },
        }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
    });

    harness.setResourceHandler(() => {
      return { status: 200, body: { success: true } };
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200, "should complete successfully");
    t.notOk(
      verifyAttempted,
      "verify should not be called for MPP even in verify-then-settle mode",
    );

    t.end();
  });

  await t.test("MPP response includes Payment-Receipt header", async (t) => {
    const { interceptor: captureInterceptor, captured } =
      createCaptureInterceptor(matchResource);

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [captureInterceptor, createMPPResponseInterceptor()],
    });

    harness.setResourceHandler(() => {
      return { status: 200, body: { success: true } };
    });

    const fetch = harness.createFetch();
    await fetch("/test-resource");

    // The second captured request is the paid retry (first is the initial 402)
    const paidRequest = captured[1];
    t.ok(paidRequest, "should have a paid request");

    const paidResponse = paidRequest?.response;
    t.ok(paidResponse, "should have a paid response");

    const receiptHeader = paidResponse?.headers.get("Payment-Receipt");
    t.ok(receiptHeader, "response should include Payment-Receipt header");

    if (receiptHeader) {
      const receiptJSON = base64url.decodeBase64url(receiptHeader);
      const receipt = JSON.parse(receiptJSON) as {
        status: string;
        method: string;
        timestamp: string;
        reference: string;
      };

      t.equal(receipt.status, "success", "receipt status should be success");
      t.ok(receipt.method, "receipt should include method");
      t.ok(receipt.timestamp, "receipt should include timestamp");
      t.ok(receipt.reference, "receipt should include reference");
    }

    t.end();
  });

  await t.test("MPP client sends Authorization: Payment header", async (t) => {
    const { interceptor: captureInterceptor, captured } =
      createCaptureInterceptor(matchResource);

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [captureInterceptor, createMPPResponseInterceptor()],
    });

    harness.setResourceHandler(() => {
      return { status: 200, body: { success: true } };
    });

    const fetch = harness.createFetch();
    await fetch("/test-resource");

    // First capture is the initial request (gets 402)
    // Second capture is the retry with payment
    const paidCapture = captured[1];
    t.ok(paidCapture, "should have a paid request capture");

    const authHeader = paidCapture?.init?.headers;
    t.ok(authHeader, "paid request should have headers");

    // The headers are set by the wrap function as a Headers object
    if (authHeader instanceof Headers) {
      const authValue = authHeader.get("Authorization");
      t.ok(authValue, "should have Authorization header");
      t.ok(
        authValue?.startsWith("Payment "),
        "Authorization header should start with 'Payment '",
      );
    }

    t.end();
  });

  await t.test("MPP resource handler receives v2 context", async (t) => {
    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
    });

    let wasV2Context = false;

    harness.setResourceHandler((ctx) => {
      // MPP uses v2 context types since it converts to x402v2 internally
      wasV2Context = isResourceContextV2(ctx);

      if (isResourceContextV2(ctx)) {
        t.ok(ctx.paymentRequirements, "should have payment requirements");
        t.ok(ctx.paymentPayload, "should have payment payload");
        t.ok(ctx.settleResponse, "should have settle response");
        t.ok(ctx.settleResponse?.transaction, "should have transaction field");
      }

      return { status: 200, body: { success: true } };
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200, "should return 200");
    t.ok(wasV2Context, "context should be v2 (MPP uses v2 internally)");

    t.end();
  });

  await t.test(
    "MPP response includes Cache-Control: private header",
    async (t) => {
      const { interceptor: captureInterceptor, captured } =
        createCaptureInterceptor(matchResource);

      const harness = new TestHarness({
        supportedVersions: { mpp: true },
        settleMode: "settle-only",
        accepts: [accepts()],
        facilitatorHandlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        clientHandlers: [createTestPaymentHandler()],
        clientInterceptors: [
          captureInterceptor,
          createMPPResponseInterceptor(),
        ],
      });

      harness.setResourceHandler(() => {
        return { status: 200, body: { success: true } };
      });

      const fetch = harness.createFetch();
      await fetch("/test-resource");

      const paidResponse = captured[1]?.response;
      t.ok(paidResponse, "should have a paid response");

      const cacheControl = paidResponse?.headers.get("Cache-Control");
      t.equal(
        cacheControl,
        "private",
        "should set Cache-Control: private per MPP spec",
      );

      t.end();
    },
  );
});
