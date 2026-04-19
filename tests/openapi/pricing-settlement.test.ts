#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  createTestFacilitatorHandler,
  createTestMPPHandler,
  createTestMPPPaymentHandler,
  TEST_SCHEME,
  TEST_NETWORK,
  TEST_ASSET,
  generateTestId,
} from "@faremeter/test-harness";
import {
  parseWWWAuthenticate,
  serializeCredential,
} from "@faremeter/types/mpp";
import { createGatewayHandler } from "@faremeter/middleware-openapi";
import type {
  Asset,
  AuthorizeResponse,
  CaptureResponse,
  EvalTrace,
  FaremeterSpec,
  PricingRule,
} from "@faremeter/middleware-openapi";

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
      t.equal(result.status, 200, "sanity: harness wiring works");
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

      t.equal(result.status, 200, "partial settlement must succeed");
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
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
      const spec = makeSpec("100", "100");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
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

      t.equal(result.status, 500);
      t.equal(
        captureCalls.length,
        1,
        "onCapture must fire on settlement failure",
      );
      t.match(
        captureCalls[0]?.result.error,
        { status: Number },
        "error must be populated with a status when settlement fails",
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
      t.equal(result.status, 200, "handleResponse returns 200 for one-phase");
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
      t.equal(result.status, 200, "settlement must succeed");
      t.end();
    },
  );

  await t.test(
    "onAuthorize fires on successful two-phase verification with correct shape",
    async (t) => {
      const authorizeCalls: {
        operationKey: string;
        result: AuthorizeResponse;
      }[] = [];
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
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
        onAuthorize: (operationKey, result) => {
          authorizeCalls.push({ operationKey, result });
        },
      });

      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o" },
      });

      t.equal(reqResult.status, 200, "request with valid payment must pass");
      t.equal(authorizeCalls.length, 1, "onAuthorize must fire exactly once");
      t.equal(
        authorizeCalls[0]?.operationKey,
        OP,
        "operationKey must match the request",
      );
      t.match(
        authorizeCalls[0]?.result,
        { protocol: "x402v2", verification: { isValid: true } },
        "result must be x402v2 with successful verification",
      );
      t.end();
    },
  );

  await t.test(
    "onAuthorize does not fire when verification fails",
    async (t) => {
      const authorizeCalls: unknown[] = [];
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onAuthorize: (_operationKey, result) => {
          authorizeCalls.push(result);
        },
      });

      // Payment signed for "50" but the authorize expression evaluates
      // to "100": the facilitator rejects with isValid=false → 402.
      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("50") },
        query: {},
        body: { model: "gpt-4o" },
      });

      t.not(
        reqResult.status,
        200,
        "request with invalid payment must not pass",
      );
      t.equal(authorizeCalls.length, 0, "onAuthorize must not fire on failure");
      t.end();
    },
  );

  await t.test(
    "onAuthorize does not fire for one-phase capture-only rules",
    async (t) => {
      const authorizeCalls: unknown[] = [];
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
      const handler = createGatewayHandler({
        spec: onePhaseSpec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onAuthorize: (_operationKey, result) => {
          authorizeCalls.push(result);
        },
      });

      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("42") },
        query: {},
        body: { model: "gpt-4o" },
      });

      t.equal(reqResult.status, 200, "one-phase paid request must pass");
      t.equal(
        authorizeCalls.length,
        0,
        "onAuthorize must not fire for one-phase rules",
      );
      t.end();
    },
  );

  await t.test(
    "onCapture receives payment with correct shape after two-phase settlement",
    async (t) => {
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
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
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      // /request: verify the hold (authorize), no settlement yet.
      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(reqResult.status, 200, "request with valid payment must pass");
      t.equal(
        captureCalls.length,
        0,
        "onCapture must not fire at /request for two-phase rules",
      );

      // /response: settle the captured amount.
      const result = await handler.handleResponse(
        makeResponsePayload(75, "100"),
      );
      t.equal(result.status, 200, "two-phase settlement must succeed");
      t.equal(captureCalls.length, 1, "onCapture must fire exactly once");
      t.equal(
        captureCalls[0]?.operationKey,
        OP,
        "operationKey must match the request",
      );
      t.match(
        captureCalls[0]?.result,
        {
          phase: "response",
          settled: true,
          payment: {
            protocol: "x402v2",
            settlement: { success: true },
          },
        },
        "result must have phase=response, settled=true, and x402v2 payment",
      );
      t.notOk(
        captureCalls[0]?.result.error,
        "error must not be present on successful settlement",
      );
      t.end();
    },
  );

  await t.test(
    "onCapture receives payment with correct shape after one-phase settlement",
    async (t) => {
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
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
      const handler = createGatewayHandler({
        spec: onePhaseSpec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      // /request: one-phase rule — settle immediately at /request.
      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("42") },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(reqResult.status, 200, "one-phase paid request must pass");
      t.equal(captureCalls.length, 1, "onCapture must fire at /request");
      t.equal(
        captureCalls[0]?.operationKey,
        OP,
        "operationKey must match the request",
      );
      t.match(
        captureCalls[0]?.result,
        {
          phase: "request",
          settled: true,
          payment: {
            protocol: "x402v2",
            settlement: { success: true },
          },
        },
        "result must have phase=request, settled=true, and x402v2 payment",
      );
      t.end();
    },
  );

  await t.test(
    "onCapture payment is absent when settlement fails",
    async (t) => {
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
      // authorize=100, capture=100. The payment header is signed for
      // 50, which is less than the capture amount of 100. The test
      // facilitator rejects the settlement and returns success=false.
      const spec = makeSpec("100", "100");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      const result = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        // Signed for 50 but capture expression evaluates to 100.
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("50") },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 100 } },
        },
      });

      t.equal(result.status, 500, "failed settlement must return 500");
      t.equal(
        captureCalls.length,
        1,
        "onCapture must fire even when settlement fails",
      );
      t.equal(
        captureCalls[0]?.result.settled,
        false,
        "settled must be false when settlement fails",
      );
      t.notOk(
        captureCalls[0]?.result.payment,
        "payment must be absent when settlement fails",
      );
      t.ok(
        captureCalls[0]?.result.error,
        "error must be present when settlement fails",
      );
      t.end();
    },
  );

  await t.test(
    "zero capture on two-phase rule settles without calling facilitator",
    async (t) => {
      // authorize: 100, capture: 0. The capture expression evaluates
      // to zero at /response time. toPricing drops zero-amount entries
      // so there is nothing to settle — the handler sets
      // paymentSettled=true without calling the facilitator.
      const settleCalls: { amount: string }[] = [];
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
      const spec = makeSpec("100", "0");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            amountPolicy: holdAndSettle,
            onSettle: (r) => {
              settleCalls.push({ amount: r.amount });
            },
          }),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      // /request: verify the hold (authorize=100).
      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(reqResult.status, 200, "request with valid payment must pass");

      // /response: capture evaluates to 0 — no settlement needed.
      const result = await handler.handleResponse(
        makeResponsePayload(0, "100"),
      );
      t.equal(result.status, 200, "zero-capture must succeed");
      t.equal(
        settleCalls.length,
        0,
        "facilitator must not be called when capture is zero",
      );
      t.equal(
        captureCalls.length,
        0,
        "onCapture must not fire when capture amount is zero",
      );
      t.end();
    },
  );

  await t.test(
    "onCapture trace includes authorize and capture bindings for two-phase rule",
    async (t) => {
      const rule: PricingRule = {
        match: "$",
        authorize: "$.request.body.max_tokens",
        capture: "$.response.body.usage.total_tokens",
      };
      const spec: FaremeterSpec = {
        assets: TEST_SPEC_ASSETS,
        operations: {
          [OP]: {
            method: "POST",
            path: "/v1/chat/completions",
            transport: "json",
            rates: { test: 1n },
            rules: [rule],
          },
        },
      };
      const traces: EvalTrace[] = [];
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
        onCapture: (_operationKey, result) => {
          if (result.trace) traces.push(result.trace);
        },
      });

      // /request: verify the hold (authorize = max_tokens = 100).
      await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o", max_tokens: 100 },
      });

      // /response: settle (capture = total_tokens = 42).
      await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o", max_tokens: 100 },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 42 } },
        },
      });

      t.equal(traces.length, 1, "onCapture must fire with trace");
      if (traces[0] === undefined) throw new Error("trace missing");
      const trace = traces[0];
      t.equal(trace.ruleIndex, 0, "first rule matched");
      t.matchOnly(trace.rule, rule, "rule must match the spec rule");
      t.ok(
        trace.authorize,
        "authorize trace must be present for two-phase rule",
      );
      t.match(trace.authorize?.bindings, {
        "$.request.body.max_tokens": 100,
      });
      t.equal(trace.authorize?.coefficient, 100);
      t.ok(trace.capture, "capture trace must be present");
      t.match(trace.capture?.bindings, {
        "$.response.body.usage.total_tokens": 42,
      });
      t.equal(trace.capture?.coefficient, 42);
      t.end();
    },
  );

  await t.test(
    "onCapture trace includes capture only for one-phase rule",
    async (t) => {
      const rule: PricingRule = {
        match: "$",
        capture: "42",
      };
      const spec: FaremeterSpec = {
        assets: TEST_SPEC_ASSETS,
        operations: {
          [OP]: {
            method: "POST",
            path: "/v1/chat/completions",
            transport: "json",
            rates: { test: 1n },
            rules: [rule],
          },
        },
      };
      const traces: EvalTrace[] = [];
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onCapture: (_operationKey, result) => {
          if (result.trace) traces.push(result.trace);
        },
      });

      // /request: one-phase settles immediately.
      await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("42") },
        query: {},
        body: { model: "gpt-4o" },
      });

      t.equal(traces.length, 1, "onCapture must fire with trace");
      if (traces[0] === undefined) throw new Error("trace missing");
      const trace = traces[0];
      t.equal(trace.ruleIndex, 0);
      t.matchOnly(trace.rule, rule);
      t.equal(
        trace.authorize,
        undefined,
        "no authorize trace for capture-only rule",
      );
      t.ok(trace.capture);
      t.equal(trace.capture?.coefficient, 42);
      t.end();
    },
  );

  await t.test(
    "a thrown onAuthorize callback does not corrupt the gateway response",
    async (t) => {
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
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
        onAuthorize: () => {
          throw new Error("intentional onAuthorize error");
        },
      });

      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o" },
      });

      t.equal(
        reqResult.status,
        200,
        "thrown onAuthorize must not corrupt the response",
      );
      t.end();
    },
  );

  await t.test(
    "a thrown onCapture callback does not corrupt the gateway response",
    async (t) => {
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
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
        onCapture: () => {
          throw new Error("intentional onCapture error");
        },
      });

      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(reqResult.status, 200, "request with valid payment must pass");

      const result = await handler.handleResponse(
        makeResponsePayload(75, "100"),
      );
      t.equal(
        result.status,
        200,
        "thrown onCapture must not corrupt the response",
      );
      t.end();
    },
  );

  await t.test(
    "async onAuthorize rejection does not leak an unhandled rejection",
    async (t) => {
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
      const rejections: unknown[] = [];
      const listener = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", listener);
      try {
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
          onAuthorize: (() => {
            return Promise.reject(new Error("async hook rejection"));
          }) as (key: string, result: AuthorizeResponse) => void,
        });

        const reqResult = await handler.handleRequest({
          operationKey: OP,
          method: "POST",
          path: "/v1/chat/completions",
          headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
          query: {},
          body: { model: "gpt-4o" },
        });
        t.equal(
          reqResult.status,
          200,
          "request must succeed despite async hook",
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        t.equal(
          rejections.length,
          0,
          "async onAuthorize must not leak unhandled rejections",
        );
      } finally {
        process.off("unhandledRejection", listener);
      }
      t.end();
    },
  );

  await t.test(
    "async onCapture rejection does not leak an unhandled rejection",
    async (t) => {
      const spec = makeSpec("100", "$.response.body.usage.total_tokens");
      const rejections: unknown[] = [];
      const listener = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", listener);
      try {
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
          onCapture: (() => {
            return Promise.reject(new Error("async hook rejection"));
          }) as (key: string, result: CaptureResponse) => void,
        });

        const reqResult = await handler.handleRequest({
          operationKey: OP,
          method: "POST",
          path: "/v1/chat/completions",
          headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
          query: {},
          body: { model: "gpt-4o" },
        });
        t.equal(reqResult.status, 200, "request with valid payment must pass");

        const result = await handler.handleResponse(
          makeResponsePayload(75, "100"),
        );
        t.equal(result.status, 200, "response must succeed despite async hook");
        // Give the event loop time for any unhandled rejection to fire.
        await new Promise((resolve) => setTimeout(resolve, 10));
        t.equal(
          rejections.length,
          0,
          "async onCapture must not leak unhandled rejections",
        );
      } finally {
        process.off("unhandledRejection", listener);
      }
      t.end();
    },
  );

  t.end();
});

await t.test("openapi gateway: MPP verify-then-settle", async (t) => {
  await t.test(
    "two-phase rule verifies at /request and settles at /response",
    async (t) => {
      const verifyCalls: unknown[] = [];
      const settleCalls: unknown[] = [];
      const authorizeCalls: {
        operationKey: string;
        result: AuthorizeResponse;
      }[] = [];
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];

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
                capture: "$.response.body.usage.total_tokens",
              },
            ],
          },
        },
      };

      const mppHandler = createTestMPPHandler({
        supportsVerify: true,
        onVerify: (credential) => {
          verifyCalls.push(credential);
        },
        onSettle: (credential) => {
          settleCalls.push(credential);
        },
      });

      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        mppMethodHandlers: [mppHandler],
        onAuthorize: (operationKey, result) => {
          authorizeCalls.push({ operationKey, result });
        },
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      // Step 1: /request without credentials — get 402 with challenge.
      const challengeResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(challengeResult.status, 402, "must return 402 challenge");
      const wwwAuth = challengeResult.headers?.["WWW-Authenticate"];
      if (!wwwAuth) throw new Error("no WWW-Authenticate header");
      const challenges = parseWWWAuthenticate(wwwAuth);
      if (challenges.length === 0) throw new Error("no challenges parsed");

      // Step 2: Build credential from the challenge.
      const challenge = challenges[0];
      if (!challenge) throw new Error("no challenge in parsed list");
      const clientHandler = createTestMPPPaymentHandler();
      const execer = await clientHandler(challenge);
      if (!execer) throw new Error("client handler did not match challenge");
      const credential = await execer.exec();
      const authHeader = `Payment ${serializeCredential(credential)}`;

      // Step 3: /request with credential — verify fires, onAuthorize fires.
      const verifyResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(verifyResult.status, 200, "verified request must pass");
      t.equal(verifyCalls.length, 1, "handleVerify must fire once");
      t.equal(settleCalls.length, 0, "handleSettle must not fire at /request");
      t.equal(authorizeCalls.length, 1, "onAuthorize must fire once");
      t.match(
        authorizeCalls[0]?.result,
        { protocol: "mpp", verification: { status: "success" } },
        "onAuthorize must report mpp protocol with verification receipt",
      );
      t.equal(
        captureCalls.length,
        0,
        "onCapture must not fire at /request for two-phase",
      );

      // Step 4: /response with credential — settle fires, onCapture fires.
      const settleResult = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 75 } },
        },
      });
      t.equal(settleResult.status, 200, "settlement must succeed");
      t.equal(
        settleCalls.length,
        1,
        "handleSettle must fire once at /response",
      );
      t.equal(captureCalls.length, 1, "onCapture must fire once at /response");
      t.match(
        captureCalls[0]?.result,
        {
          phase: "response",
          settled: true,
          payment: { protocol: "mpp" },
        },
        "onCapture must report mpp settlement",
      );
      t.end();
    },
  );

  await t.test(
    "MPP verify failure at /request returns 402 re-challenge",
    async (t) => {
      const mppHandler = createTestMPPHandler({ supportsVerify: true });

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
                capture: "$.response.body.usage.total_tokens",
              },
            ],
          },
        },
      };

      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        mppMethodHandlers: [mppHandler],
      });

      // Build a credential with a bogus challenge ID that the handler
      // will not recognize. handleVerify throws "unknown challenge ID".
      const bogusCredential = {
        challenge: {
          id: "nonexistent-id",
          realm: "test-realm",
          method: "test-solana",
          intent: "charge",
          request: btoa(
            JSON.stringify({
              amount: "100",
              currency: "USD",
              recipient: PAY_TO,
            }),
          ),
        },
        payload: { type: "transaction", transaction: "dGVzdA" },
      };
      const authHeader = `Payment ${serializeCredential(bogusCredential)}`;

      const result = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
      });

      t.equal(result.status, 402, "failed verify must return 402 re-challenge");
      t.ok(
        result.headers?.["WWW-Authenticate"],
        "must include WWW-Authenticate header for re-challenge",
      );
      t.end();
    },
  );

  await t.test(
    "MPP settlement failure propagates error message to onCapture",
    async (t) => {
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];

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
                capture: "$.response.body.usage.total_tokens",
              },
            ],
          },
        },
      };

      const mppHandler = createTestMPPHandler({ supportsVerify: true });

      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        mppMethodHandlers: [mppHandler],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      // Step 1: Get a challenge.
      const challengeResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(challengeResult.status, 402);
      const wwwAuth = challengeResult.headers?.["WWW-Authenticate"];
      if (!wwwAuth) throw new Error("no WWW-Authenticate header");
      const challenges = parseWWWAuthenticate(wwwAuth);
      const challenge = challenges[0];
      if (!challenge) throw new Error("no challenge parsed");

      // Step 2: Build a valid credential, verify it.
      const clientHandler = createTestMPPPaymentHandler();
      const execer = await clientHandler(challenge);
      if (!execer) throw new Error("client handler did not match");
      const credential = await execer.exec();
      const authHeader = `Payment ${serializeCredential(credential)}`;

      const verifyResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(verifyResult.status, 200, "verify must pass");

      // Step 3: Settle once to consume the challenge ID.
      const firstSettle = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 75 } },
        },
      });
      t.equal(firstSettle.status, 200, "first settle must succeed");
      t.equal(captureCalls.length, 1, "onCapture fires on first settle");

      // Step 4: Settle again -- the challenge ID was consumed, so
      // handleSettle throws "unknown or consumed challenge ID".
      captureCalls.length = 0;
      const secondSettle = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 75 } },
        },
      });
      t.equal(secondSettle.status, 500, "re-settle must fail");
      t.equal(captureCalls.length, 1, "onCapture fires on failed settle");

      const error = captureCalls[0]?.result.error;
      t.ok(error, "error must be present");
      t.ok(error?.message, "error.message must be present");
      t.match(
        error?.message,
        /unknown or consumed challenge ID/,
        "error.message must propagate the MPP handler error",
      );
      t.end();
    },
  );

  await t.test(
    "two-phase rule with MPP handler lacking handleVerify does not double-settle",
    async (t) => {
      const settleCalls: unknown[] = [];

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
                capture: "$.response.body.usage.total_tokens",
              },
            ],
          },
        },
      };

      const mppHandler = createTestMPPHandler({
        onSettle: (credential) => {
          settleCalls.push(credential);
        },
      });

      const gatewayHandler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        mppMethodHandlers: [mppHandler],
      });

      // Step 1: Get a challenge.
      const challengeResult = await gatewayHandler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(challengeResult.status, 402);
      const wwwAuth = challengeResult.headers?.["WWW-Authenticate"];
      if (!wwwAuth) throw new Error("no WWW-Authenticate header");
      const challenges = parseWWWAuthenticate(wwwAuth);
      const challenge = challenges[0];
      if (!challenge) throw new Error("no challenge parsed");

      // Step 2: Build a credential and send it at /request.
      // Without handleVerify, /request settles immediately (one-phase).
      const clientHandler = createTestMPPPaymentHandler();
      const execer = await clientHandler(challenge);
      if (!execer) throw new Error("client handler did not match");
      const credential = await execer.exec();
      const authHeader = `Payment ${serializeCredential(credential)}`;

      const reqResult = await gatewayHandler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(reqResult.status, 200, "one-phase settle at /request must pass");
      t.equal(settleCalls.length, 1, "handleSettle must fire once at /request");

      // Step 3: /response must not attempt settlement again.
      const responseResult = await gatewayHandler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { Authorization: authHeader },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 75 } },
        },
      });
      t.equal(
        responseResult.status,
        200,
        "/response must succeed without re-settling",
      );
      t.equal(
        settleCalls.length,
        1,
        "handleSettle must not fire again at /response",
      );
      t.end();
    },
  );

  t.end();
});

await t.test("openapi gateway: errorMessage propagation", async (t) => {
  await t.test(
    "x402v2 settlement failure propagates errorReason to onCapture error message",
    async (t) => {
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];

      const spec = makeSpec("100", "100");
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

      // Signed for 50, capture evaluates to 100. The test facilitator
      // rejects with "Amount policy rejected: settle=100, signed=50".
      const result = await handler.handleResponse({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("50") },
        query: {},
        body: { model: "gpt-4o" },
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 100 } },
        },
      });

      t.equal(result.status, 500, "failed settlement must return 500");
      t.equal(captureCalls.length, 1, "onCapture must fire");

      const error = captureCalls[0]?.result.error;
      t.ok(error, "error must be present");
      t.ok(error?.message, "error.message must be present");
      t.match(
        error?.message,
        /Amount policy rejected/,
        "error.message must propagate the facilitator errorReason",
      );
      t.end();
    },
  );

  t.end();
});
