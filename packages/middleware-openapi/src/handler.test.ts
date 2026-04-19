#!/usr/bin/env pnpm tsx

// Unit tests for createGatewayHandler's in-process behavior. Tests
// that exercise the full x402 settlement path against the test
// facilitator live in tests/openapi/pricing-settlement.test.ts —
// middleware-openapi itself must not depend on @faremeter/test-harness
// because it would create a build-order cycle in the monorepo.

import t from "tap";
import { createGatewayHandler } from "./handler";
import type { Asset, FaremeterSpec } from "./types";

const DEFAULT_ASSETS: Record<string, Asset> = {
  "usdc-sol": {
    chain: "solana:test",
    token: "TokenAddr",
    decimals: 6,
    recipient: "TestRecipient",
  },
};

const OP = "POST /v1/chat/completions";

function makeSpec(
  rules: FaremeterSpec["operations"][string]["rules"],
  rates: Record<string, bigint> = { "usdc-sol": 1n },
): FaremeterSpec {
  return {
    assets: DEFAULT_ASSETS,
    operations: {
      [OP]: {
        method: "POST",
        path: "/v1/chat/completions",
        transport: "json",
        rates,
        rules,
      },
    },
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

const BASE_URL = "http://test-gateway";

await t.test("createGatewayHandler rejects missing baseURL", (t) => {
  const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
  t.throws(
    () => createGatewayHandler({ spec, baseURL: "" }),
    /baseURL is required/,
  );
  t.end();
});

await t.test(
  "handleRequest returns 200 when operation has no rules",
  async (t) => {
    const spec = makeSpec([]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    const spec = makeSpec([{ match: "$", authorize: "0", capture: "1" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    const spec = makeSpec([{ match: "$", capture: "100" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    // POST/PUT/PATCH should carry JSON bodies. A literal `null`
    // body on these methods means the gateway could not decode
    // the client's body — fail at the boundary rather than let a
    // body-referencing match filter silently bypass billing.
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    // GET/HEAD/DELETE/OPTIONS do not carry request bodies per
    // HTTP semantics. The Lua gateway forwards `body: null` for
    // these, and the handler must accept them — rejecting null
    // universally breaks every metered GET in the entire gateway.
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    // Same contract as handleRequest: the log-phase callback for
    // a metered GET arrives with body: null because access.lua
    // never had a request body to forward. Must not throw.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    // The match context only contains `request` — any
    // `$.response.*` reference in a match filter silently returns
    // zero nodes and the rule never fires. Spec authors expecting
    // "only bill successful responses" would get zero captures
    // and zero settlements forever with no error at load time.
    const spec = makeSpec([
      {
        match: "$[?@.response.status == 200]",
        authorize: "100",
        capture: "1",
      },
    ]);
    t.throws(
      () => createGatewayHandler({ spec, baseURL: BASE_URL }),
      /match.*response|response.*match/i,
      "match expression referencing $.response.* must be rejected at construction",
    );
    t.end();
  },
);

await t.test(
  "coalesce with literal primary still validates the fallback",
  (t) => {
    // The literal-primary branch of substituteRefs discards the
    // fallback entirely instead of parse-validating it. A typo'd
    // fallback function passes construction and only surfaces if
    // the primary ever becomes nil — which a literal never does.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(5, typofunc(1, 2))",
        capture: "1",
      },
    ]);
    t.throws(
      () => createGatewayHandler({ spec, baseURL: BASE_URL }),
      /typofunc|unknown|invalid expression/i,
      "typo'd fallback must be rejected at construction",
    );
    t.end();
  },
);

await t.test(
  "negative capture coefficient rejects handleResponse",
  async (t) => {
    // A negative coefficient is a spec bug (subtraction where the
    // subtrahend exceeds the minuend). The evaluator throws, which
    // propagates out of handleResponse so the sidecar returns 500
    // and Lua retries. If retries exhaust, the hold expires and
    // the error is logged.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.a - $.response.body.b",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    await t.rejects(
      handler.handleResponse(
        responsePayload({ a: 3, b: 8 }, { model: "gpt-4o" }),
      ),
      /pricing expression evaluation failed/i,
      "negative capture coefficient must reject handleResponse",
    );
    t.end();
  },
);

await t.test(
  "handleResponse returns status 500 when two-phase rule matches but no handlers settle",
  async (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens * 2",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 50 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    // No x402/mpp handlers configured, so settlement cannot succeed.
    t.equal(result.status, 500);
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 when no rule matches",
  async (t) => {
    const spec = makeSpec([
      {
        match: '$[?@.request.body.model == "gpt-4o"]',
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    const spec = makeSpec([{ match: "$", capture: "1" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    const result = await handler.handleResponse({
      ...responsePayload({ anything: true }, {}),
      operationKey: "GET /nonexistent",
    });
    t.equal(result.status, 200);
    t.end();
  },
);

await t.test("handleResponse rejects a null request body", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "100",
      capture: "$.response.body.usage.total_tokens",
    },
  ]);
  const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
  await t.rejects(
    handler.handleResponse(
      responsePayload({ usage: { total_tokens: 42 } }, null),
    ),
    /null/i,
  );
  t.end();
});

await t.test(
  "handleResponse evaluates capture expression with full response body",
  async (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture:
          "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { prompt_tokens: 100, completion_tokens: 50 } },
        { model: "gpt-4o", messages: [] },
      ),
    );
    // Two-phase rule with no handlers: capture evaluates but
    // settlement cannot succeed.
    t.equal(result.status, 500);
    t.end();
  },
);

await t.test(
  "handleResponse rejects when capture expression fails dynamically",
  async (t) => {
    // A dynamic capture failure (missing field on the upstream
    // response) propagates out of handleResponse so the sidecar
    // returns 500 and Lua retries. Swallowing the error would
    // either silently lose the bill or overcharge the client by
    // settling the full authorized hold.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.nonexistent * 1",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    await t.rejects(
      handler.handleResponse(
        responsePayload({ other: "field" }, { model: "gpt-4o" }),
      ),
    );
    t.end();
  },
);

await t.test(
  "null body must not silently bypass a body-matched rule",
  async (t) => {
    // A match filter that references body fields cannot evaluate on
    // a null body. The spec author's intent — bill gpt-4o calls at
    // 1000 and everything else at 0 — is defeated by silently
    // falling through to the catch-all. Surface the missing body
    // rather than serving billed traffic for free.
    const spec = makeSpec([
      {
        match: '$[?@.request.body.model == "gpt-4o"]',
        authorize: "1000",
        capture: "1000",
      },
      { match: "$", authorize: "0", capture: "0" },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    await t.rejects(
      handler.handleRequest(requestPayload(null)),
      /null body|body is required|no body/i,
      "null body on a billed route must surface loudly, not silently fall through to a catch-all",
    );
    t.end();
  },
);

// See tests/openapi/pricing-settlement.test.ts for settlement-failure
// coverage — the facilitator handler lives in test-harness, so the
// assertion belongs in the cross-package test suite.

await t.test(
  "handleResponse must not silently re-evaluate authorize on a dropped body",
  async (t) => {
    // The amount settled at log-phase must equal the amount the
    // client signed at access-phase. If the caller forwards a
    // different (or missing) body, the handler must refuse to
    // settle rather than compute a new authorized amount against
    // the new body shape and send that to the facilitator.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "$.request.body.tokens * 10",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });

    // Body forwarded verbatim — capture evaluates but no handlers
    // means settlement fails.
    const withBody = await handler.handleResponse(
      responsePayload({ usage: { total_tokens: 50 } }, { tokens: 100 }),
    );
    t.equal(withBody.status, 500);

    // Body absent — must refuse, not re-derive a different amount.
    await t.rejects(
      handler.handleResponse(
        responsePayload({ usage: { total_tokens: 50 } }, null),
      ),
      /body|authorize.*mismatch|missing/i,
      "stripped body must surface as an error, not silently re-derive a new authorized amount",
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
    const spec = makeSpec([{ match: "$", capture: "50" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    // When the capture expression evaluates to zero, toPricing drops
    // the entry and handleRequest returns 200 without settling. The
    // log phase still runs (access.lua sets fm_paid on any 200), but
    // no payment was taken, so settled remains false.
    const spec = makeSpec([{ match: "$", capture: "0" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    // authorize evaluates to a non-zero hold at /request, but capture
    // evaluates to zero at /response. toPricing drops zero-amount
    // entries, so no settlement is attempted — this is not a failure.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
  "handleResponse returns status 500 for two-phase rule without handlers",
  async (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "$.request.body.max_tokens",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
    const result = await handler.handleResponse(
      responsePayload(
        { usage: { total_tokens: 42 } },
        { model: "gpt-4o", max_tokens: 100 },
      ),
    );
    t.equal(result.status, 500);
    t.end();
  },
);

await t.test(
  "handleResponse returns status 200 for capture-only rule",
  async (t) => {
    const spec = makeSpec([{ match: "$", capture: "50" }]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
    const spec = makeSpec([
      {
        match: '$[?@.request.body.model == "gpt-4o"]',
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const handler = createGatewayHandler({ spec, baseURL: BASE_URL });
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
  "onCapture does not fire when no payment handlers are configured",
  async (t) => {
    // When no x402 or mpp handlers are configured, handleMiddlewareRequest
    // returns without invoking the body callback, leaving paymentSettled=false
    // and settlementError=undefined. The onCapture hook must not fire in
    // this case — callers cannot distinguish "settlement failed" from
    // "settlement was never attempted" if both produce settled:false,
    // error:undefined.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    let captureFired = false;
    const handler = createGatewayHandler({
      spec,
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
    t.equal(result.status, 500, "no handlers means settlement cannot succeed");
    t.equal(
      captureFired,
      false,
      "onCapture must not fire when no handlers are configured",
    );
    t.end();
  },
);
