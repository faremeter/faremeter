#!/usr/bin/env pnpm tsx

import t from "tap";
import { createPricingEvaluator } from "./evaluator";
import { buildContext, withResponse } from "./context";
import type { Asset, FaremeterSpec } from "./types";

const DEFAULT_ASSETS: Record<string, Asset> = {
  "usdc-sol": {
    chain: "solana:test",
    token: "TokenAddr",
    decimals: 6,
    recipient: "TestRecipient",
  },
};

function makeSpec(
  rules: FaremeterSpec["operations"][string]["rules"],
  rates: Record<string, number> = { "usdc-sol": 1 },
  assets: Record<string, Asset> = DEFAULT_ASSETS,
): FaremeterSpec {
  return {
    assets,
    operations: {
      "POST /v1/chat/completions": { rates, rules },
    },
  };
}

function requestCtx(body?: Record<string, unknown>) {
  return buildContext({
    body: body ?? { model: "gpt-4o", messages: [] },
    headers: {},
    path: "/v1/chat/completions",
  });
}

const OP = "POST /v1/chat/completions";

await t.test("first matching rule wins", (t) => {
  const spec = makeSpec([
    {
      match: '$[?@.request.body.model == "gpt-4o"]',
      capture: "100",
    },
    { match: "$", capture: "999" },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.capture(OP, requestCtx());
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 100n);
  t.end();
});

await t.test("catch-all rule matches when nothing else does", (t) => {
  const spec = makeSpec([
    {
      match: '$[?@.request.body.model == "gpt-4o"]',
      capture: "100",
    },
    { match: "$", capture: "999" },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.capture(
    OP,
    requestCtx({ model: "unknown-model", messages: [] }),
  );
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 999n);
  t.end();
});

await t.test("no match returns matched false", (t) => {
  const spec = makeSpec([
    {
      match: '$[?@.request.body.model == "gpt-4o"]',
      capture: "100",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.capture(
    OP,
    requestCtx({ model: "other", messages: [] }),
  );
  t.equal(result.matched, false);
  t.same(result.amount, {});
  t.end();
});

await t.test("unknown operation returns matched false", (t) => {
  const spec = makeSpec([{ match: "$", capture: "100" }]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.capture("GET /nonexistent", requestCtx());
  t.equal(result.matched, false);
  t.end();
});

await t.test("authorize evaluates with request context only", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "42",
      capture: "$.response.body.usage.prompt_tokens * 10",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(OP, requestCtx());
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 42n);
  t.end();
});

await t.test(
  "authorize without authorize expression returns matched with empty amount",
  (t) => {
    const spec = makeSpec([
      {
        match: "$",
        capture: "$.response.body.usage.prompt_tokens * 10",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx());
    t.equal(result.matched, true);
    t.same(result.amount, {});
    t.end();
  },
);

await t.test("capture uses response data", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "1000",
      capture:
        "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const ctx = withResponse(requestCtx(), {
    body: { usage: { prompt_tokens: 100, completion_tokens: 50 } },
    headers: {},
    status: 200,
  });
  const result = evaluator.capture(OP, ctx);
  t.equal(result.matched, true);
  // 100 * 10 + 50 * 30 = 2500
  t.equal(result.amount["usdc-sol"], 2500n);
  t.end();
});

await t.test("rates multiply the coefficient", (t) => {
  const multiAssets: Record<string, Asset> = {
    "usdc-sol": {
      chain: "solana:test",
      token: "TokenAddr",
      decimals: 6,
      recipient: "TestRecipient",
    },
    "usdc-base": {
      chain: "base:test",
      token: "BaseTokenAddr",
      decimals: 6,
      recipient: "BaseRecipient",
    },
  };
  const spec = makeSpec(
    [{ match: "$", capture: "100" }],
    { "usdc-sol": 2, "usdc-base": 3 },
    multiAssets,
  );
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.capture(OP, requestCtx());
  t.equal(result.amount["usdc-sol"], 200n);
  t.equal(result.amount["usdc-base"], 300n);
  t.end();
});

await t.test("jsonSize custom function works in expressions", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "jsonSize($.request.body.messages) / 4",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const messages = [{ role: "user", content: "Hello, how are you today?" }];
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages }),
  );
  t.equal(result.matched, true);
  const expectedSize = JSON.stringify(messages).length / 4;
  t.equal(result.amount["usdc-sol"], BigInt(Math.ceil(expectedSize)));
  t.end();
});

await t.test("malformed match expression skips to next rule", (t) => {
  const spec = makeSpec([
    {
      match: "$.request.body.nonexistent.deep.path[?@ == true]",
      capture: "100",
    },
    { match: "$", capture: "200" },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.capture(OP, requestCtx());
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 200n);
  t.end();
});

await t.test(
  "malformed capture expression throws on evaluation failure",
  (t) => {
    const spec = makeSpec([
      {
        match: "$",
        capture: "$.response.body.nonexistent.deep.path * 10",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    t.throws(() => evaluator.capture(OP, requestCtx()));
    t.end();
  },
);

await t.test("regex match works for model patterns", (t) => {
  const spec = makeSpec([
    {
      match: '$[?match(@.request.body.model, "claude-sonnet.*")]',
      capture: "50",
    },
    { match: "$", capture: "10" },
  ]);
  const evaluator = createPricingEvaluator(spec);

  const matched = evaluator.capture(
    OP,
    requestCtx({ model: "claude-sonnet-4-6", messages: [] }),
  );
  t.equal(matched.amount["usdc-sol"], 50n);

  const noMatch = evaluator.capture(
    OP,
    requestCtx({ model: "gpt-4o", messages: [] }),
  );
  t.equal(noMatch.amount["usdc-sol"], 10n);

  t.end();
});

await t.test("getAssets returns spec assets", (t) => {
  const spec = makeSpec([]);
  const evaluator = createPricingEvaluator(spec);
  t.same(evaluator.getAssets(), {
    "usdc-sol": {
      chain: "solana:test",
      token: "TokenAddr",
      decimals: 6,
      recipient: "TestRecipient",
    },
  });
  t.end();
});

await t.test(
  "capture with authorize expression uses response data for capture",
  (t) => {
    const spec = makeSpec([
      {
        match: '$[?@.request.body.model == "gpt-4o"]',
        authorize: "5000",
        capture:
          "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);

    const authResult = evaluator.authorize(OP, requestCtx());
    t.equal(authResult.amount["usdc-sol"], 5000n);

    const ctx = withResponse(requestCtx(), {
      body: { usage: { prompt_tokens: 200, completion_tokens: 100 } },
      headers: {},
      status: 200,
    });
    const capResult = evaluator.capture(OP, ctx);
    // 200 * 10 + 100 * 30 = 5000
    t.equal(capResult.amount["usdc-sol"], 5000n);

    t.end();
  },
);

await t.test("authorize with buffer math produces non-empty amount", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize:
        "(jsonSize($.request.body.messages) / 4 * 10 + 1024 * 30) * 115 / 100",
      capture: "$.response.body.usage.prompt_tokens * 10",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const messages = [{ role: "user", content: "Hello, how are you today?" }];
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages }),
  );
  t.equal(result.matched, true);
  t.ok(
    result.amount["usdc-sol"] !== undefined && result.amount["usdc-sol"] > 0n,
    "authorize should produce a non-zero amount",
  );
  t.end();
});

await t.test("expression evaluation failure throws and fires onError", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "$.request.body.nonexistent.deep * 1.5",
      capture: "1",
    },
  ]);
  const errors: { phase: string }[] = [];
  const evaluator = createPricingEvaluator(spec, {
    onError: (err) => errors.push({ phase: err.phase }),
  });
  t.throws(() => evaluator.authorize(OP, requestCtx()));
  t.equal(errors.length, 1);
  t.equal(errors[0]?.phase, "authorize");
  t.end();
});

await t.test("coalesce provides default for missing fields", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "coalesce($.request.body.max_tokens, 1024) * 10",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [] }),
  );
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 10240n);
  t.end();
});

await t.test("coalesce returns value when field is present", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "coalesce($.request.body.max_tokens, 1024) * 10",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [], max_tokens: 512 }),
  );
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 5120n);
  t.end();
});

await t.test("coalesce with nested function call as default", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize:
        "coalesce($.request.body.max_tokens, jsonSize($.request.body.messages))",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const messages = [{ role: "user", content: "Hello" }];
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages }),
  );
  t.equal(result.matched, true);
  t.equal(
    result.amount["usdc-sol"],
    BigInt(Math.ceil(JSON.stringify(messages).length)),
  );
  t.end();
});

await t.test("bracket notation for special-character keys", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "$.request.body['x-custom-field'] * 10",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [], "x-custom-field": 5 }),
  );
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 50n);
  t.end();
});

await t.test("coalesce with zero value returns zero not default", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "coalesce($.request.body.max_tokens, 1024)",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [], max_tokens: 0 }),
  );
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 0n);
  t.end();
});

await t.test("coalesce fallback preserves operator precedence", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "coalesce($.request.body.missing, 2 + 3) * 10",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [] }),
  );
  t.equal(result.matched, true);
  // (2 + 3) * 10 = 50, not 2 + 3 * 10 = 32
  t.equal(result.amount["usdc-sol"], 50n);
  t.end();
});

await t.test("multiple coalesce calls in one expression", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize:
        "coalesce($.request.body.max_tokens, 1024) + coalesce($.request.body.temperature, 1)",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [] }),
  );
  t.equal(result.matched, true);
  // Both missing: 1024 + 1 = 1025
  t.equal(result.amount["usdc-sol"], 1025n);
  t.end();
});

await t.test("negative coefficient is clamped to zero", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      capture: "$.response.body.usage.prompt_tokens - 1000",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const ctx = withResponse(requestCtx(), {
    body: { usage: { prompt_tokens: 10 } },
    headers: {},
    status: 200,
  });
  const result = evaluator.capture(OP, ctx);
  t.equal(result.matched, true);
  // 10 - 1000 = -990, clamped to 0
  t.equal(result.amount["usdc-sol"], 0n);
  t.end();
});

await t.test("invalid JSONPath in match throws at construction", (t) => {
  const spec = makeSpec([{ match: "$[???broken", capture: "1" }]);
  t.throws(
    () => createPricingEvaluator(spec),
    /rule 0 match: invalid JSONPath/,
  );
  t.end();
});

await t.test("invalid arithmetic in capture throws at construction", (t) => {
  const spec = makeSpec([{ match: "$", capture: "1 +" }]);
  t.throws(
    () => createPricingEvaluator(spec),
    /rule 0 capture: invalid expression/,
  );
  t.end();
});

await t.test("invalid arithmetic in authorize throws at construction", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "$.request.body.x *",
      capture: "1",
    },
  ]);
  t.throws(
    () => createPricingEvaluator(spec),
    /rule 0 authorize: invalid expression/,
  );
  t.end();
});

await t.test("missing authorize does not trigger validation failure", (t) => {
  const spec = makeSpec([
    { match: "$", capture: "$.response.body.usage.prompt_tokens * 10" },
  ]);
  t.doesNotThrow(() => createPricingEvaluator(spec));
  t.end();
});

await t.test(
  "invalid arithmetic in coalesce fallback throws at construction",
  (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce($.request.body.max_tokens, 1 +) * 10",
        capture: "1",
      },
    ]);
    t.throws(
      () => createPricingEvaluator(spec),
      /rule 0 authorize: invalid expression/,
    );
    t.end();
  },
);

await t.test("valid spec with all expression types passes validation", (t) => {
  const spec = makeSpec([
    {
      match: '$[?@.request.body.model == "gpt-4o"]',
      authorize:
        "(jsonSize($.request.body.messages) / 4 * 10 + coalesce($.request.body.max_tokens, 1024) * 30) * 115 / 100",
      capture:
        "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
    },
    { match: "$", capture: "1" },
  ]);
  t.doesNotThrow(() => createPricingEvaluator(spec));
  t.end();
});

await t.test("rate key not matching any asset throws at construction", (t) => {
  const spec = makeSpec([{ match: "$", capture: "1" }], {
    "nonexistent-asset": 1,
  });
  t.throws(
    () => createPricingEvaluator(spec),
    /rate key "nonexistent-asset" does not match any defined asset/,
  );
  t.end();
});

await t.test("array index notation in JSONPath expressions", (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "$.request.body.items[0].price * 1",
      capture: "1",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const result = evaluator.authorize(
    OP,
    requestCtx({ model: "gpt-4o", messages: [], items: [{ price: 42 }] }),
  );
  t.equal(result.matched, true);
  t.equal(result.amount["usdc-sol"], 42n);
  t.end();
});
