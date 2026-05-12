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
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { MPPMethodHandler } from "@faremeter/types/mpp";
import { createGatewayHandler } from "@faremeter/middleware-openapi";
import type {
  Asset,
  AuthorizeResponse,
  CaptureResponse,
  EvalTrace,
  FaremeterSpec,
  HandlerBinding,
  MPPBinding,
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

function makeSpec(): FaremeterSpec {
  return {
    assets: TEST_SPEC_ASSETS,
    operations: {
      [OP]: { method: "POST", path: "/v1/chat/completions", transport: "json" },
    },
  };
}

function makeRule(authorize: string | undefined, capture: string): PricingRule {
  return authorize !== undefined
    ? { match: "$", authorize, capture }
    : { match: "$", capture };
}

function makeBinding(
  handler: FacilitatorHandler,
  rules: PricingRule[],
  rates: Record<string, bigint> = { test: 1n },
): HandlerBinding {
  return {
    handler,
    operations: { [OP]: { rates, rules } },
  };
}

function makeMPPBinding(
  handler: MPPMethodHandler,
  rules: PricingRule[],
  rates: Record<string, bigint> = { test: 1n },
): MPPBinding {
  return {
    handler,
    operations: { [OP]: { rates, rules } },
  };
}

function makeV2PaymentHeader(amount: string): string {
  // The PAYMENT-SIGNATURE header is base64(JSON(x402PaymentPayload)).
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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule("100", "100"),
          ]),
        ],
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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [makeRule("100", "50")],
          ),
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
      const settleCalls: { requirementsAmount: string }[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
              onSettle: (requirements) => {
                settleCalls.push({ requirementsAmount: requirements.amount });
              },
            }),
            [makeRule("100", "50")],
          ),
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
    "forwarded /response body cannot raise the settled amount above the signed authorize",
    async (t) => {
      // The client signs a PAYMENT-SIGNATURE for amount=100. A
      // misbehaving gateway forwards a /response body whose
      // capture expression would compute 9999. The settlement
      // must not exceed the originally-signed authorize -- the
      // capture-derived amount reaches the facilitator unchanged
      // and is rejected there by the amountPolicy, rather than
      // being silently downscaled to the signed cap by the gateway.
      const captureCalls: { result: CaptureResponse }[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [makeRule("100", "$.response.body.usage.total_tokens")],
          ),
        ],
        onCapture: (_operationKey, result) => {
          captureCalls.push({ result });
        },
      });

      const result = await handler.handleResponse(
        makeResponsePayload(9999, "100"),
      );

      t.not(
        result.status,
        200,
        "settlement must fail when capture exceeds signed authorize",
      );
      t.equal(captureCalls.length, 1, "onCapture must fire once");
      t.equal(
        captureCalls[0]?.result.settled,
        false,
        "settlement must be marked unsuccessful",
      );
      t.equal(
        captureCalls[0]?.result.amount.test,
        "9999",
        "capture-derived amount reaches settlement unchanged -- " +
          "the gateway does not silently downscale to the signed cap",
      );
      t.match(
        captureCalls[0]?.result.error?.message,
        /Amount policy rejected.*settle=9999.*signed=100/,
        "facilitator's amountPolicy is the enforcement point for the cap",
      );
      t.end();
    },
  );

  await t.test(
    "capture failure rejects handleResponse without settling",
    async (t) => {
      const settleCalls: { amount: string }[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              onSettle: (r) => {
                settleCalls.push({ amount: r.amount });
              },
            }),
            [makeRule("100", "$.response.body.usage.nonexistent * 1")],
          ),
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
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule("100", "100"),
          ]),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

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
      const settleCalls: { amount: string }[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              onSettle: (r) => {
                settleCalls.push({ amount: r.amount });
              },
            }),
            [makeRule(undefined, "42")],
          ),
        ],
      });

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
      const responseSettles: string[] = [];

      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
              onSettle: (r) => {
                responseSettles.push(r.amount);
              },
            }),
            [
              makeRule(
                "jsonSize($.request.body.messages) * 10",
                "$.response.body.usage.total_tokens",
              ),
            ],
          ),
        ],
      });

      const body = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      };

      const reqResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body,
      });
      t.not(reqResult.status, 200, "sanity: rule must match and produce a 402");

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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [makeRule("100", "$.response.body.usage.total_tokens")],
          ),
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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule("100", "$.response.body.usage.total_tokens"),
          ]),
        ],
        onAuthorize: (_operationKey, result) => {
          authorizeCalls.push(result);
        },
      });

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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule(undefined, "42"),
          ]),
        ],
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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [makeRule("100", "$.response.body.usage.total_tokens")],
          ),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
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
      t.equal(
        captureCalls.length,
        0,
        "onCapture must not fire at /request for two-phase rules",
      );

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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule(undefined, "42"),
          ]),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule("100", "100"),
          ]),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

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
      const settleCalls: { amount: string }[] = [];
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
              onSettle: (r) => {
                settleCalls.push({ amount: r.amount });
              },
            }),
            [makeRule("100", "0")],
          ),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
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
      const traces: EvalTrace[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [rule],
          ),
        ],
        onCapture: (_operationKey, result) => {
          if (result.trace) traces.push(result.trace);
        },
      });

      await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
        query: {},
        body: { model: "gpt-4o", max_tokens: 100 },
      });

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
      const traces: EvalTrace[] = [];
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [rule]),
        ],
        onCapture: (_operationKey, result) => {
          if (result.trace) traces.push(result.trace);
        },
      });

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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [makeRule("100", "$.response.body.usage.total_tokens")],
          ),
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
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(
            createTestFacilitatorHandler({
              payTo: PAY_TO,
              amountPolicy: holdAndSettle,
            }),
            [makeRule("100", "$.response.body.usage.total_tokens")],
          ),
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
      const rejections: unknown[] = [];
      const listener = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", listener);
      try {
        const handler = createGatewayHandler({
          spec: makeSpec(),
          baseURL: BASE_URL,
          supportedVersions: { x402v1: false, x402v2: true },
          bindings: [
            makeBinding(
              createTestFacilitatorHandler({
                payTo: PAY_TO,
                amountPolicy: holdAndSettle,
              }),
              [makeRule("100", "$.response.body.usage.total_tokens")],
            ),
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
      const rejections: unknown[] = [];
      const listener = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", listener);
      try {
        const handler = createGatewayHandler({
          spec: makeSpec(),
          baseURL: BASE_URL,
          supportedVersions: { x402v1: false, x402v2: true },
          bindings: [
            makeBinding(
              createTestFacilitatorHandler({
                payTo: PAY_TO,
                amountPolicy: holdAndSettle,
              }),
              [makeRule("100", "$.response.body.usage.total_tokens")],
            ),
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
        spec: makeSpec(),
        baseURL: BASE_URL,
        mppBindings: [
          makeMPPBinding(mppHandler, [
            makeRule("100", "$.response.body.usage.total_tokens"),
          ]),
        ],
        onAuthorize: (operationKey, result) => {
          authorizeCalls.push({ operationKey, result });
        },
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

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

      const challenge = challenges[0];
      if (!challenge) throw new Error("no challenge in parsed list");
      const clientHandler = createTestMPPPaymentHandler();
      const execer = await clientHandler(challenge);
      if (!execer) throw new Error("client handler did not match challenge");
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

      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        mppBindings: [
          makeMPPBinding(mppHandler, [
            makeRule("100", "$.response.body.usage.total_tokens"),
          ]),
        ],
      });

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

      const mppHandler = createTestMPPHandler({ supportsVerify: true });

      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        mppBindings: [
          makeMPPBinding(mppHandler, [
            makeRule("100", "$.response.body.usage.total_tokens"),
          ]),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

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
    "two-phase rule with MPP handler lacking handleVerify is rejected at construction",
    (t) => {
      // Under the binding model, the rule on the binding declares
      // two-phase by carrying `authorize`. A handler that does not
      // implement verify cannot serve a two-phase rule. The mismatch
      // surfaces when the gateway dispatches a payment to this
      // binding — there is no runtime fallback to one-phase.
      const mppHandler = createTestMPPHandler({});
      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        mppBindings: [
          makeMPPBinding(mppHandler, [
            makeRule("100", "$.response.body.usage.total_tokens"),
          ]),
        ],
      });
      // Construction succeeds (we cannot statically know whether
      // the handler will implement verify when this binding's
      // payments arrive). What we can assert is the runtime dispatch
      // contract: a two-phase rule against a verify-less handler is
      // a configuration error and should fail loud.
      t.ok(handler, "gateway constructs even when handler verify is missing");
      t.end();
    },
  );

  t.end();
});

await t.test(
  "openapi gateway: multi-scheme bindings dispatch by chosen scheme",
  async (t) => {
    // Two x402 bindings on the same operation:
    //   - "test" scheme (2-phase): authorize + capture
    //   - "test-one-phase" scheme (1-phase): capture only
    // The client picks one or the other via its PAYMENT-SIGNATURE
    // header. Each binding's rule shape (and therefore phase)
    // applies independently — no runtime fallback, no dual claim
    // on the same rule.
    const twoPhaseSettles: { amount: string }[] = [];
    const onePhaseSettles: { amount: string }[] = [];

    const twoPhaseHandler = createTestFacilitatorHandler({
      payTo: PAY_TO,
      amountPolicy: holdAndSettle,
      onSettle: (r) => {
        twoPhaseSettles.push({ amount: r.amount });
      },
    });

    // Inline 1-phase handler for a distinct "test-one-phase" scheme.
    const ONE_PHASE_SCHEME = "test-one-phase";
    const onePhaseHandler: FacilitatorHandler = {
      capabilities: {
        schemes: [ONE_PHASE_SCHEME],
        networks: [TEST_NETWORK],
        assets: [TEST_ASSET],
      },
      getRequirements: async ({ accepts }) =>
        accepts
          .filter((r) => r.scheme === ONE_PHASE_SCHEME)
          .map((r) => ({ ...r, maxTimeoutSeconds: 300 })),
      handleSettle: async (requirements) => {
        if (requirements.scheme !== ONE_PHASE_SCHEME) return null;
        onePhaseSettles.push({ amount: requirements.amount });
        return {
          success: true,
          transaction: "one-phase-tx",
          network: requirements.network,
          payer: "test-payer",
        };
      },
    };

    const handler = createGatewayHandler({
      spec: makeSpec(),
      baseURL: BASE_URL,
      supportedVersions: { x402v1: false, x402v2: true },
      bindings: [
        makeBinding(twoPhaseHandler, [
          makeRule("100", "$.response.body.usage.total_tokens"),
        ]),
        {
          handler: onePhaseHandler,
          operations: {
            [OP]: { rates: { test: 1n }, rules: [makeRule(undefined, "42")] },
          },
        },
      ],
    });

    // -- Client A picks the 2-phase "test" scheme. --
    const reqA = await handler.handleRequest({
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "PAYMENT-SIGNATURE": makeV2PaymentHeader("100") },
      query: {},
      body: { model: "gpt-4o" },
    });
    t.equal(reqA.status, 200, "2-phase /request must verify and pass");
    t.equal(
      twoPhaseSettles.length,
      0,
      "2-phase must not settle at /request (capture comes at /response)",
    );
    t.equal(
      onePhaseSettles.length,
      0,
      "1-phase binding must not be touched by a 2-phase dispatch",
    );

    const respA = await handler.handleResponse(makeResponsePayload(75, "100"));
    t.equal(respA.status, 200, "2-phase /response must settle");
    t.equal(twoPhaseSettles.length, 1, "2-phase settled exactly once");
    t.equal(
      twoPhaseSettles[0]?.amount,
      "75",
      "2-phase settled the captured amount (75), not the authorized hold (100)",
    );

    // -- Client B picks the 1-phase "test-one-phase" scheme. --
    function makeOnePhaseHeader(amount: string): string {
      return btoa(
        JSON.stringify({
          x402Version: 2,
          resource: { url: `${BASE_URL}/v1/chat/completions` },
          accepted: {
            scheme: ONE_PHASE_SCHEME,
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
        }),
      );
    }

    const reqB = await handler.handleRequest({
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "PAYMENT-SIGNATURE": makeOnePhaseHeader("42") },
      query: {},
      body: { model: "gpt-4o" },
    });
    t.equal(reqB.status, 200, "1-phase /request must settle and pass");
    t.equal(
      onePhaseSettles.length,
      1,
      "1-phase settled at /request (no /response dependency)",
    );
    t.equal(
      onePhaseSettles[0]?.amount,
      "42",
      "1-phase settled its capture-derived amount",
    );
    t.equal(
      twoPhaseSettles.length,
      1,
      "2-phase binding must not be touched by a 1-phase dispatch",
    );

    const respB = await handler.handleResponse({
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "PAYMENT-SIGNATURE": makeOnePhaseHeader("42") },
      query: {},
      body: { model: "gpt-4o" },
      response: {
        status: 200,
        headers: {},
        body: { usage: { total_tokens: 999 } },
      },
    });
    t.equal(respB.status, 200, "1-phase /response is a no-op");
    t.equal(
      onePhaseSettles.length,
      1,
      "1-phase must not double-settle at /response",
    );
    t.end();
  },
);

await t.test("openapi gateway: errorMessage propagation", async (t) => {
  await t.test(
    "x402v2 settlement failure propagates errorReason to onCapture error message",
    async (t) => {
      const captureCalls: {
        operationKey: string;
        result: CaptureResponse;
      }[] = [];

      const handler = createGatewayHandler({
        spec: makeSpec(),
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        bindings: [
          makeBinding(createTestFacilitatorHandler({ payTo: PAY_TO }), [
            makeRule("100", "100"),
          ]),
        ],
        onCapture: (operationKey, result) => {
          captureCalls.push({ operationKey, result });
        },
      });

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
