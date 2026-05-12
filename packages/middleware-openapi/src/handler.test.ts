#!/usr/bin/env pnpm tsx

// Unit tests for createGatewayHandler's in-process behavior. Tests
// that exercise the full x402 settlement path against the test
// facilitator live in tests/openapi/pricing-settlement.test.ts —
// middleware-openapi itself must not depend on @faremeter/test-harness
// because it would create a build-order cycle in the monorepo.

import t from "tap";
import { createGatewayHandler } from "./handler";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type {
  Asset,
  FaremeterSpec,
  HandlerBinding,
  PricingRule,
} from "./types";

const DEFAULT_ASSETS: Record<string, Asset> = {
  "usdc-sol": {
    chain: "solana:test",
    token: "TokenAddr",
    decimals: 6,
    recipient: "TestRecipient",
  },
};

const OP = "POST /v1/chat/completions";
const BASE_URL = "http://test-gateway";

function makeSpec(): FaremeterSpec {
  return {
    assets: DEFAULT_ASSETS,
    operations: {
      [OP]: { method: "POST", path: "/v1/chat/completions", transport: "json" },
    },
  };
}

// Minimal facilitator stub: declares capabilities aligned with
// DEFAULT_ASSETS so the middleware emits accepts entries for it, but
// never actually settles. Tests that need real settlement live in
// pricing-settlement.test.ts.
function makeStubHandler(scheme = "test"): FacilitatorHandler {
  return {
    capabilities: {
      schemes: [scheme],
      networks: ["solana:test"],
      assets: ["TokenAddr"],
    },
    getRequirements: async ({ accepts }) => accepts,
    handleSettle: async () => null,
  };
}

function makeBinding(
  rules: PricingRule[],
  rates: Record<string, bigint> = { "usdc-sol": 1n },
): HandlerBinding {
  return {
    handler: makeStubHandler(),
    operations: { [OP]: { rates, rules } },
  };
}

function requestPayload(body: Record<string, unknown> | null = null) {
  return {
    operationKey: OP,
    method: "POST",
    path: "/v1/chat/completions",
    headers: {},
    query: {},
    body,
  };
}

function responsePayload(
  responseBody: Record<string, unknown>,
  requestBody: Record<string, unknown> | null = null,
) {
  return {
    ...requestPayload(requestBody),
    response: {
      status: 200,
      headers: {},
      body: responseBody,
    },
  };
}

await t.test("createGatewayHandler rejects missing baseURL", (t) => {
  t.throws(
    () => createGatewayHandler({ spec: makeSpec(), baseURL: "" }),
    /baseURL is required/,
  );
  t.end();
});

await t.test(
  "handleRequest returns 200 when no bindings advertise pricing",
  async (t) => {
    // No bindings → no pricing → pass-through.
    const handler = createGatewayHandler({
      spec: makeSpec(),
      baseURL: BASE_URL,
    });
    const result = await handler.handleRequest(
      requestPayload({ model: "gpt-4o" }),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleRequest returns 200 for an unknown operationKey",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleRequest({
      ...requestPayload({ model: "gpt-4o" }),
      operationKey: "GET /nonexistent",
    });
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleRequest returns 200 when authorize coefficient is zero",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "0", capture: "1" }]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleRequest(
      requestPayload({ model: "gpt-4o" }),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleRequest returns non-200 for a capture-only rule (one-phase pricing)",
  async (t) => {
    // One-phase pricing: a rule with only `capture` (no `authorize`)
    // should evaluate the capture expression at request time and
    // return a payment-required response. Without this, the request
    // passes through unpaid and the spec author's intent to charge
    // upfront is silently ignored.
    const bindings = [makeBinding([{ match: "$", capture: "100" }])];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleRequest(
      requestPayload({ model: "gpt-4o" }),
    );
    t.not(
      result.status,
      200,
      "capture-only rule must trigger a payment challenge, not pass through",
    );
    t.end();
  },
);

await t.test(
  "handleRequest rejects a null body for methods that normally carry bodies",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    for (const method of ["POST", "PUT", "PATCH"]) {
      await t.rejects(
        handler.handleRequest({ ...requestPayload(null), method }),
        /null/i,
        `${method} with null body must be rejected`,
      );
    }
    t.end();
  },
);

await t.test(
  "handleRequest accepts a null body for HTTP methods without bodies",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    for (const method of ["GET", "HEAD", "DELETE", "OPTIONS"]) {
      await t.resolves(
        handler.handleRequest({ ...requestPayload(null), method }),
        `${method} with null body must be accepted`,
      );
    }
    t.end();
  },
);

await t.test(
  "handleResponse accepts a null request body for bodyless HTTP methods",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.usage.total_tokens",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const payload = {
      ...responsePayload({ usage: { total_tokens: 50 } }, null),
      method: "GET",
    };
    await t.resolves(handler.handleResponse(payload));
    t.end();
  },
);

// Cross-package settlement tests that need a real facilitator handler
// live in tests/openapi/pricing-settlement.test.ts — they use
// @faremeter/test-harness which cannot be imported from this package
// without breaking the monorepo build order.

await t.test(
  "createPricingEvaluator rejects match expressions referencing $.response.*",
  (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$[?@.response.status == 200]",
          authorize: "100",
          capture: "1",
        },
      ]),
    ];
    t.throws(
      () =>
        createGatewayHandler({
          spec: makeSpec(),
          bindings,
          baseURL: BASE_URL,
        }),
      /match.*response|response.*match/i,
      "match expression referencing $.response.* must be rejected at construction",
    );
    t.end();
  },
);

await t.test(
  "coalesce with literal primary still validates the fallback",
  (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "coalesce(5, typofunc(1, 2))",
          capture: "1",
        },
      ]),
    ];
    t.throws(
      () =>
        createGatewayHandler({
          spec: makeSpec(),
          bindings,
          baseURL: BASE_URL,
        }),
      /typofunc|unknown|invalid expression/i,
      "typo'd fallback must be rejected at construction",
    );
    t.end();
  },
);

await t.test(
  "negative capture coefficient rejects handleResponse at evaluation",
  async (t) => {
    // The handler evaluates two-phase capture upfront at /response
    // so spec bugs (like a negative coefficient) surface as a
    // load-phase rejection rather than silently being skipped.
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.a - $.response.body.b",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    await t.rejects(
      handler.handleResponse(
        responsePayload({ a: 3, b: 8 }, { model: "gpt-4o" }),
      ),
      /pricing expression evaluation failed/i,
    );
    t.end();
  },
);

await t.test(
  "handleResponse returns 500 for two-phase rule without payment dispatch",
  async (t) => {
    // /response is invoked by the Lua gateway after the upstream
    // request succeeded. If a two-phase binding's authorize ran at
    // /request (verifying a hold), the same payment header must
    // reach /response so the capture amount can be settled. A
    // missing header here means the gateway dropped the payment;
    // the response phase cannot settle so the gateway returns
    // non-2xx (Lua retries; the operator sees a real signal).
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.usage.total_tokens * 2",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    t.equal(result.status, 500);
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 when no rule matches",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: '$[?@.request.body.model == "gpt-4o"]',
          authorize: "100",
          capture: "$.response.body.usage.total_tokens",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "claude-sonnet", messages: [] },
      ),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleResponse with unknown operationKey returns status 200",
  async (t) => {
    const bindings = [makeBinding([{ match: "$", capture: "1" }])];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse({
      ...responsePayload({ anything: true }, {}),
      operationKey: "GET /nonexistent",
    });
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test("handleResponse rejects a null request body", async (t) => {
  const bindings = [
    makeBinding([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]),
  ];
  const handler = createGatewayHandler({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
  });
  await t.rejects(
    handler.handleResponse(
      responsePayload({ usage: { total_tokens: 42 } }, null),
    ),
    /null/i,
  );
  t.end();
});

// Settlement-path behaviors (capture evaluation, dynamic failures,
// negative coefficients, body integrity) require a real payment to
// dispatch and live in tests/openapi/pricing-settlement.test.ts. The
// unit tests here cover the gateway surface that does not depend on
// the payment-protocol harness.

await t.test(
  "null body must not silently bypass a body-matched rule",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: '$[?@.request.body.model == "gpt-4o"]',
          authorize: "1000",
          capture: "1000",
        },
        { match: "$", authorize: "0", capture: "0" },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    await t.rejects(
      handler.handleRequest(requestPayload(null)),
      /null body|body is required|no body/i,
      "null body on a billed route must surface loudly, not silently fall through to a catch-all",
    );
    t.end();
  },
);

await t.test(
  "handleResponse rejects null body for body-carrying methods",
  async (t) => {
    // POST/PUT/PATCH must carry a body; the gateway forwards
    // body: null only when it could not decode the client request.
    // /response must surface this rather than silently coercing.
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "$.request.body.tokens * 10",
          capture: "$.response.body.usage.total_tokens",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });

    await t.rejects(
      handler.handleResponse(
        responsePayload({ usage: { total_tokens: 50 } }, null),
      ),
      /body|null|missing/i,
      "null body on body-carrying method must surface as an error",
    );
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 for one-phase rule with non-zero capture",
  async (t) => {
    // One-phase (capture-only) rules settle at /request time. When
    // handleResponse is called it means /request returned 200, which
    // means settlement already succeeded.
    const bindings = [makeBinding([{ match: "$", capture: "50" }])];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 for one-phase rule with zero capture",
  async (t) => {
    const bindings = [makeBinding([{ match: "$", capture: "0" }])];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 0 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 for two-phase rule with zero capture",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.usage.total_tokens",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 0 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

// Settlement-failure status (500) coverage lives in the integration
// suite, where real payment headers drive dispatch through the
// facilitator handler.

await t.test(
  "handleResponse returns status 200 for capture-only rule",
  async (t) => {
    const bindings = [makeBinding([{ match: "$", capture: "50" }])];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 when no rule matches",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: '$[?@.request.body.model == "gpt-4o"]',
          authorize: "100",
          capture: "$.response.body.usage.total_tokens",
        },
      ]),
    ];
    const handler = createGatewayHandler({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "claude-sonnet", messages: [] },
      ),
    );
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test(
  "onCapture does not fire when no bindings are configured",
  async (t) => {
    // No bindings → no pricing advertised → no body callback invoked
    // → onCapture must not fire.
    let captureFired = false;
    const handler = createGatewayHandler({
      spec: makeSpec(),
      baseURL: BASE_URL,
      onCapture: () => {
        captureFired = true;
      },
    });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    t.equal(
      result.status,
      200,
      "no bindings means no pricing, no settlement, pass through",
    );
    t.equal(
      captureFired,
      false,
      "onCapture must not fire when no bindings are configured",
    );
    t.end();
  },
);

await t.test(
  "createGatewayHandler rejects duplicate schemes across bindings",
  (t) => {
    const bindings = [
      makeBinding([{ match: "$", capture: "1" }]),
      makeBinding([{ match: "$", capture: "2" }]),
    ];
    // Both bindings declare scheme "test" via the stub.
    t.throws(
      () =>
        createGatewayHandler({
          spec: makeSpec(),
          bindings,
          baseURL: BASE_URL,
        }),
      /scheme.*more than one binding/i,
    );
    t.end();
  },
);
