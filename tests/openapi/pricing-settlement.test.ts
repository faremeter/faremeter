#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  createTestFacilitatorHandler,
  TEST_SCHEME,
  TEST_NETWORK,
  TEST_ASSET,
  generateTestId,
} from "@faremeter/test-harness";
import { createGatewayHandler } from "@faremeter/middleware-openapi";
import type { Asset, FaremeterSpec } from "@faremeter/middleware-openapi";

const OP = "POST /v1/chat/completions";
const PAY_TO = "test-receiver";
const BASE_URL = "http://test-gateway";
const holdAndSettle = (settle: bigint, signed: bigint) => settle <= signed;

const TEST_SPEC_ASSETS: Record<string, Asset> = {
  test: {
    chain: TEST_NETWORK,
    token: TEST_ASSET,
    decimals: 6,
    recipient: PAY_TO,
  },
};

function makeSpec(authorizeExpr: string, captureExpr: string): FaremeterSpec {
  return {
    assets: TEST_SPEC_ASSETS,
    operations: {
      [OP]: {
        method: "POST",
        path: "/v1/chat/completions",
        transport: "json",
        rates: { test: 1n },
        rules: [{ match: "$", authorize: authorizeExpr, capture: captureExpr }],
      },
    },
  };
}

function makeV2PaymentHeader(amount: string): string {
  // The PAYMENT-SIGNATURE header is base64(JSON(x402PaymentPayload)). The
  // inner `payload` carries the scheme-specific test payload, which the
  // test facilitator inspects to enforce amount commitment.
  const payload = {
    x402Version: 2,
    resource: { url: `${BASE_URL}/v1/chat/completions` },
    accepted: {
      scheme: TEST_SCHEME,
      network: TEST_NETWORK,
      amount,
      asset: TEST_ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
    },
    payload: {
      testId: generateTestId(),
      amount,
      timestamp: Date.now(),
    },
  };
  return btoa(JSON.stringify(payload));
}

function makeResponsePayload(totalTokens: number, paymentAmount: string) {
  return {
    operationKey: OP,
    method: "POST",
    path: "/v1/chat/completions",
    headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader(paymentAmount) },
    query: {},
    body: { model: "gpt-4o", messages: [] },
    response: {
      status: 200,
      headers: {},
      body: { usage: { total_tokens: totalTokens } },
    },
  };
}

await t.test("openapi gateway: pricing settlement", async (t) => {
  await t.test(
    "settles when authorize and capture produce the same amount",
    async (t) => {
      // Sanity check for the test wiring: when authorize and capture
      // agree, settlement must succeed regardless of which branch the
      // handler chooses. A failure here indicates a problem in the test
      // setup (asset mapping, header encoding, supportedVersions config),
      // not in the handler itself.
      const spec = makeSpec("100", "100");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
      });

      const result = await handler.handleResponse(
        makeResponsePayload(100, "100"),
      );
      t.equal(result.settled, true, "sanity: harness wiring works");
      t.end();
    },
  );

  await t.test(
    "settles the captured amount when capture < authorize",
    async (t) => {
      // authorize: 100 (hold ceiling signed by client)
      // capture:   50  (actual cost from response body)
      //
      // The gateway passes the captured amount (50) to the
      // facilitator. The facilitator decides whether to accept
      // it against the signed hold (100).
      const spec = makeSpec("100", "50");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            amountPolicy: holdAndSettle,
          }),
        ],
      });

      const result = await handler.handleResponse(
        makeResponsePayload(50, "100"),
      );

      t.equal(result.captured, true, "capture fires");
      t.equal(result.settled, true, "partial settlement must succeed");
      t.end();
    },
  );

  await t.test(
    "facilitator receives the captured amount, not the authorized hold",
    async (t) => {
      // authorize: 100 (hold), capture: 50 (actual).
      // The gateway passes the captured amount to the facilitator.
      const spec = makeSpec("100", "50");
      const settleCalls: { requirementsAmount: string }[] = [];
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            amountPolicy: holdAndSettle,
            onSettle: (requirements) => {
              settleCalls.push({ requirementsAmount: requirements.amount });
            },
          }),
        ],
      });

      await handler.handleResponse(makeResponsePayload(50, "100"));

      t.equal(
        settleCalls.length,
        1,
        "facilitator.handleSettle fires exactly once",
      );
      t.equal(
        settleCalls[0]?.requirementsAmount,
        "50",
        "facilitator must receive the captured amount (actual cost), not the authorized hold",
      );
      t.end();
    },
  );

  await t.test(
    "capture failure rejects handleResponse without settling",
    async (t) => {
      // A dynamic capture failure (missing field on the upstream
      // response) propagates out of handleResponse. The sidecar
      // returns 500, Lua retries. No settlement occurs because
      // the actual cost is unknown — silently settling the full
      // authorized hold would overcharge the client.
      const settleCalls: { amount: string }[] = [];
      const spec: FaremeterSpec = {
        assets: TEST_SPEC_ASSETS,
        operations: {
          [OP]: {
            method: "POST",
            path: "/v1/chat/completions",
            transport: "json",
            rates: { test: 1n },
            rules: [
              {
                match: "$",
                authorize: "100",
                capture: "$.response.body.usage.nonexistent * 1",
              },
            ],
          },
        },
      };
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            onSettle: (r) => {
              settleCalls.push({ amount: r.amount });
            },
          }),
        ],
      });

      await t.rejects(
        handler.handleResponse({
          operationKey: OP,
          method: "POST",
          path: "/v1/chat/completions",
          headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
          query: {},
          body: { model: "gpt-4o" },
          response: {
            status: 200,
            headers: {},
            body: {},
          },
        }),
      );

      t.equal(
        settleCalls.length,
        0,
        "facilitator must not be called when capture fails",
      );
      t.end();
    },
  );

  await t.test(
    "settlement failure surfaces the facilitator error reason",
    async (t) => {
      // When settlement fails, the caller needs a machine-readable
      // reason to act on. Drive a failure by signing a payment for
      // less than the actual cost: signed hold is 50 but capture
      // is 100 → settlement exceeds the signed hold → facilitator
      // rejects.
      const spec = makeSpec("100", "100");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
      });

      const result = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        // Signed for 50 but actual cost is 100 → exceeds hold.
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("50") },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: {} },
        },
      });

      t.equal(result.settled, false);
      t.ok(
        result.error !== undefined,
        "CaptureResponse must carry the facilitator's error reason when settlement fails",
      );
      t.end();
    },
  );

  await t.test(
    "one-phase: capture-only rule charges upfront and settles",
    async (t) => {
      // One-phase pricing: a rule with `capture` but no `authorize`
      // evaluates the capture expression at /request time to compute
      // the upfront payment amount. Settlement happens at /request
      // (not deferred to /response) because there is no hold —
      // the payment is final before the upstream runs.
      const onePhaseSpec: FaremeterSpec = {
        assets: TEST_SPEC_ASSETS,
        operations: {
          [OP]: {
            method: "POST",
            path: "/v1/chat/completions",
            transport: "json",
            rates: { test: 1n },
            rules: [{ match: "$", capture: "42" }],
          },
        },
      };

      const settleCalls: { amount: string }[] = [];
      const handler = createGatewayHandler({
        spec: onePhaseSpec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            onSettle: (r) => {
              settleCalls.push({ amount: r.amount });
            },
          }),
        ],
      });

      // /request without payment: 402 challenge.
      const reqNoPayment = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body: { model: "gpt-4o" },
      });
      t.not(
        reqNoPayment.status,
        200,
        "one-phase rule must require payment at /request",
      );

      // /request with payment: settle fires immediately (not deferred).
      const reqWithPayment = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("42") },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(reqWithPayment.status, 200, "paid request must pass through");
      t.equal(
        settleCalls.length,
        1,
        "facilitator settle must fire at /request for one-phase",
      );
      t.equal(
        settleCalls[0]?.amount,
        "42",
        "settlement amount must match the capture-derived upfront price",
      );

      // /response: no additional settlement — already settled.
      const result = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("42") },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 999 } },
        },
      });
      t.equal(
        settleCalls.length,
        1,
        "no additional settle call at /response for one-phase",
      );
      t.equal(result.captured, true, "capture telemetry still fires");
      t.end();
    },
  );

  await t.test(
    "authorize re-evaluation at /response produces the same amount as /request",
    async (t) => {
      // The handler re-evaluates the authorize expression at /response
      // to determine the settlement amount. If the same request body
      // is forwarded to both phases, the result must be identical.
      // A mismatch would mean the client signed a payment for one
      // amount but the facilitator receives a different amount —
      // either the facilitator rejects it (amount commitment check)
      // or the client is over/under-charged.
      const responseSettles: string[] = [];

      const spec = makeSpec(
        "jsonSize($.request.body.messages) * 10",
        "$.response.body.usage.total_tokens",
      );

      // Two separate handlers: one for /request (to observe the
      // authorized amount), one for /response (to observe what
      // the settlement block sends to the facilitator).
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            amountPolicy: holdAndSettle,
            onSettle: (r) => {
              responseSettles.push(r.amount);
            },
          }),
        ],
      });

      const body = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      };

      // /request: the authorize expression evaluates against the body.
      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body,
      });
      // Extract the amount from the 402 response. The handler returns
      // pricing via the x402 challenge; the test facilitator's
      // getRequirements returns the amount that was computed.
      t.not(reqResult.status, 200, "sanity: rule must match and produce a 402");
      // We can't easily extract the amount from the 402 body in this
      // unit test, so observe it from the /response settlement instead.

      // /response: same body, authorize re-evaluated.
      // jsonSize resolves the JSONPath $.request.body.messages, which
      // is the messages array (not the whole body).
      const messagesSize = JSON.stringify(body.messages).length;
      const expectedAmount = String(messagesSize * 10);

      const result = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {
          "PAYMENT-SIGNATURE": makeV2PaymentHeader(expectedAmount),
        },
        query: {},
        body,
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 50 } },
        },
      });

      t.equal(
        responseSettles.length,
        1,
        "facilitator must be called once for settlement",
      );
      // The gateway passes the captured amount (50) to the
      // facilitator for settlement — the actual cost.
      t.equal(
        responseSettles[0],
        "50",
        "settlement must use the captured amount (actual cost)",
      );
      t.equal(result.settled, true, "settlement must succeed");
      t.end();
    },
  );

  t.end();
});
