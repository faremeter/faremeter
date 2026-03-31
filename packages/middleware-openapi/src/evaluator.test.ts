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
  rates: Record<string, bigint> = { "usdc-sol": 1n },
  assets: Record<string, Asset> = DEFAULT_ASSETS,
): FaremeterSpec {
  return {
    assets,
    operations: {
      "POST /v1/chat/completions": {
        method: "POST",
        path: "/v1/chat/completions",
        transport: "json",
        rates,
        rules,
      },
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
  "one-phase: authorize uses capture expression when authorize is absent",
  (t) => {
    // One-phase pricing: a rule with only `capture` (no `authorize`)
    // evaluates the capture expression at request time to compute
    // the upfront payment amount. The expression can only use
    // $.request.* fields since the response doesn't exist yet.
    const spec = makeSpec([
      {
        match: "$",
        capture: "42",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx());
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      42n,
      "authorize must evaluate the capture expression when authorize is absent",
    );
    t.end();
  },
);

await t.test(
  "one-phase: capture-only rule with $.response.* is rejected at construction",
  (t) => {
    // A capture-only rule runs its expression at request time (before
    // the response exists). Referencing $.response.* would silently
    // resolve to zero nodes and produce the wrong price. Reject at
    // construction so the spec author gets a clear signal.
    t.throws(
      () =>
        createPricingEvaluator(
          makeSpec([
            {
              match: "$",
              capture: "$.response.body.usage.prompt_tokens * 10",
            },
          ]),
        ),
      /one-phase|response/i,
      "capture-only rule referencing $.response must be rejected",
    );
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
    { "usdc-sol": 2n, "usdc-base": 3n },
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
        authorize: "100",
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

await t.test("negative coefficient surfaces as an error", (t) => {
  // Silently clamping `Math.max(0, coefficient)` to zero hides a
  // spec bug (subtraction where the subtrahend can exceed the
  // minuend) from the spec author. The evaluator must reject
  // negative coefficients loudly; handleResponse catches the
  // capture throw and surfaces it via `captureError` without
  // blocking settlement of the authorized amount.
  const spec = makeSpec([
    {
      match: "$",
      authorize: "100",
      capture: "$.response.body.usage.prompt_tokens - 1000",
    },
  ]);
  const evaluator = createPricingEvaluator(spec);
  const ctx = withResponse(requestCtx(), {
    body: { usage: { prompt_tokens: 10 } },
    headers: {},
    status: 200,
  });
  // `evaluateRules` wraps the underlying `buildResult` throw with
  // a generic "pricing expression evaluation failed" wrapper and
  // stashes the leaf in `cause`. Unwrap here to assert the leaf
  // message carries the negative-coefficient signal so the
  // wrapping layer does not hide the root cause.
  let caught: unknown;
  try {
    evaluator.capture(OP, ctx);
  } catch (err) {
    caught = err;
  }
  t.ok(caught instanceof Error, "capture must throw on negative coefficient");
  const leaf =
    caught instanceof Error && caught.cause instanceof Error
      ? caught.cause
      : caught;
  t.match(
    leaf instanceof Error ? leaf.message : String(leaf),
    /negative|coefficient/i,
    "leaf error must identify the negative coefficient",
  );
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

await t.test(
  "missing authorize with request-only capture does not trigger validation failure",
  (t) => {
    // One-phase rules are valid when the capture expression only
    // references $.request.* fields — it runs pre-request, so
    // request data is always available.
    const spec = makeSpec([{ match: "$", capture: "42" }]);
    t.doesNotThrow(() => createPricingEvaluator(spec));
    t.end();
  },
);

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
    "nonexistent-asset": 1n,
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

await t.test(
  "non-finite expression result throws rather than settling NaN",
  (t) => {
    // 1 / 0 in expr-eval yields Infinity; resolveExpression must reject,
    // and evaluateRules wraps the error with a pricing-phase prefix.
    const spec = makeSpec([
      { match: "$", capture: "1 / ($.request.body.zero)" },
    ]);
    const evaluator = createPricingEvaluator(spec);
    let caught: unknown;
    try {
      evaluator.capture(
        OP,
        requestCtx({ model: "gpt-4o", messages: [], zero: 0 }),
      );
    } catch (err) {
      caught = err;
    }
    t.ok(caught instanceof Error, "throws an Error");
    t.match((caught as Error).message, /pricing expression evaluation failed/);
    t.match(
      String((caught as Error).cause),
      /non-finite/,
      "underlying cause identifies non-finite value",
    );
    t.end();
  },
);

await t.test(
  "large-rate multiplication stays exact beyond Number precision",
  (t) => {
    // 2^60 fits in bigint comfortably but overflows Number safe integers.
    // With coefficient 1000 and rate 2^60, the true amount is 1000 * 2^60.
    const hugeRate = 1n << 60n;
    const spec = makeSpec([{ match: "$", capture: "1000" }], {
      "usdc-sol": hugeRate,
    });
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.capture(OP, requestCtx());
    t.equal(result.amount["usdc-sol"], 1000n * hugeRate);
    t.end();
  },
);

await t.test(
  "fractional coefficient contribution rounds up via ceiling",
  (t) => {
    // coefficient 0.1, rate 10 → expected ceil(1) = 1
    // coefficient 0.1, rate 11 → expected ceil(1.1) = 2
    const evaluatorA = createPricingEvaluator(
      makeSpec([{ match: "$", capture: "0.1" }], { "usdc-sol": 10n }),
    );
    t.equal(evaluatorA.capture(OP, requestCtx()).amount["usdc-sol"], 1n);

    const evaluatorB = createPricingEvaluator(
      makeSpec([{ match: "$", capture: "0.1" }], { "usdc-sol": 11n }),
    );
    t.equal(evaluatorB.capture(OP, requestCtx()).amount["usdc-sol"], 2n);
    t.end();
  },
);

await t.test("non-numeric JSONPath value throws loudly", (t) => {
  const spec = makeSpec([{ match: "$", capture: "$.request.body.model * 1" }]);
  const evaluator = createPricingEvaluator(spec);
  // model is "gpt-4o" — not coercible to a finite number via Number("gpt-4o")
  t.throws(() => evaluator.capture(OP, requestCtx()));
  t.end();
});

await t.test(
  "fractional arithmetic that is not IEEE-exact must not overcharge",
  (t) => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. With rate 10 the true
    // amount is 3, but Math.ceil(0.30000000000000004 * 10) = 4. The pricing
    // engine must not silently overcharge by 1 atomic unit because of a
    // representation bias in the input expression.
    const evaluator = createPricingEvaluator(
      makeSpec([{ match: "$", capture: "0.1 + 0.2" }], { "usdc-sol": 10n }),
    );
    t.equal(evaluator.capture(OP, requestCtx()).amount["usdc-sol"], 3n);
    t.end();
  },
);

await t.test("coalesce with literal primary is a valid expression", (t) => {
  // coalesce(5, 10) is a well-formed nullish-coalesce where the primary
  // happens to be a literal. Construction must not reject it just because
  // the primary is not a JSONPath reference.
  const spec = makeSpec([
    {
      match: "$",
      authorize: "coalesce(5, 10)",
      capture: "1",
    },
  ]);
  let evaluator;
  try {
    evaluator = createPricingEvaluator(spec);
  } catch (err) {
    t.fail(`construction should not throw: ${String(err)}`);
    t.end();
    return;
  }
  const result = evaluator.authorize(OP, requestCtx());
  t.equal(result.amount["usdc-sol"], 5n);
  t.end();
});

await t.test(
  "user identifier _v0 must not silently collide with internal substitution",
  (t) => {
    // The evaluator substitutes JSONPath refs into generated variable
    // names _v0, _v1, ... If a user writes an expression that uses _v0
    // directly, the evaluator must either reject it at construction or
    // produce the semantically correct value — never silently double-count
    // by having two bindings share the same name.
    const spec = makeSpec([
      {
        match: "$",
        capture: "_v0 + $.request.body.n",
      },
    ]);
    const body = { model: "gpt-4o", messages: [], n: 10 };
    // Either construction rejects this as an invalid identifier, or the
    // evaluator produces the honest answer. In no case should the amount be
    // 20 (the double-billing result of _v0 aliasing n).
    let amount: bigint | undefined;
    try {
      const evaluator = createPricingEvaluator(spec);
      amount = evaluator.capture(OP, requestCtx(body)).amount["usdc-sol"];
    } catch {
      // construction or evaluation rejected the reserved identifier; acceptable.
      t.pass("evaluator rejects reserved _v0 identifier");
      t.end();
      return;
    }
    t.not(amount, 20n, "_v0 must not silently double-count the JSONPath ref");
    t.end();
  },
);

await t.test(
  "bare JSONPath selector in match must fire when the field exists",
  (t) => {
    // A rule like { match: "$.request.body.foo", capture: "10" } should
    // match when request.body.foo is present. The evaluator must not
    // silently treat this as a non-match because of how the match context
    // is shaped internally.
    const spec = makeSpec([
      { match: "$.request.body.foo", capture: "10" },
      { match: "$", capture: "1" },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.capture(
      OP,
      requestCtx({ model: "gpt-4o", messages: [], foo: "anything" }),
    );
    t.equal(
      result.amount["usdc-sol"],
      10n,
      "bare selector matched the present field",
    );
    t.end();
  },
);

await t.test("empty capture expression is rejected at construction", (t) => {
  const spec = makeSpec([{ match: "$", capture: "" }]);
  t.throws(
    () => createPricingEvaluator(spec),
    /capture/,
    "empty capture must not pass validation",
  );
  t.end();
});

await t.test("empty authorize expression is rejected at construction", (t) => {
  const spec = makeSpec([{ match: "$", authorize: "", capture: "1" }]);
  t.throws(
    () => createPricingEvaluator(spec),
    /authorize/,
    "empty authorize must not pass validation",
  );
  t.end();
});

await t.test(
  "authorize referencing $.response.* is rejected at construction",
  (t) => {
    // The authorize phase runs before any response exists. A spec that
    // references $.response in authorize is always a load-time mistake,
    // not a runtime one — the validator has enough information to reject
    // it.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "$.response.body.cost * 10",
        capture: "1",
      },
    ]);
    t.throws(
      () => createPricingEvaluator(spec),
      /authorize/,
      "authorize must not reference response-phase context",
    );
    t.end();
  },
);

await t.test(
  "buildResult must not crash for coefficients in the 1e21+ range",
  (t) => {
    // Number.prototype.toFixed switches to exponential notation for
    // magnitudes >= 1e21, so the toFixed-based fixed-point conversion
    // produces a string like "1e+21" that BigInt cannot parse. A
    // user-authorable expression producing such a coefficient must
    // evaluate to a correct bigint amount — not surface as an unhandled
    // SyntaxError from the precision machinery.
    const evaluator = createPricingEvaluator(
      makeSpec([{ match: "$", capture: "1e21" }], { "usdc-sol": 1n }),
    );
    const result = evaluator.capture(OP, requestCtx());
    t.equal(result.amount["usdc-sol"], 10n ** 21n);
    t.end();
  },
);

await t.test(
  "buildResult must not undercharge sub-scale coefficients on USDC",
  (t) => {
    // USDC uses 6-decimal atomic units. A capture expression of 1e-7
    // with a rate of 1e12 should settle 1e5 atomic units (0.1 USDC).
    // Tying the fixed-point scale to asset.decimals causes the
    // coefficient to round to zero at toFixed(6) *before* the rate is
    // applied, silently undercharging to 0. This is the canonical
    // high-rate / small-coefficient case and is the reason the scale
    // must be decoupled from asset.decimals.
    const evaluator = createPricingEvaluator(
      makeSpec([{ match: "$", capture: "0.0000001" }], {
        "usdc-sol": 10n ** 12n,
      }),
    );
    const result = evaluator.capture(OP, requestCtx());
    t.equal(
      result.amount["usdc-sol"],
      100000n,
      "1e-7 * 1e12 = 1e5 atomic units (0.1 USDC), not 0",
    );
    t.end();
  },
);

await t.test(
  "buildResult must ceil any positive coefficient to at least 1 atomic unit",
  (t) => {
    // Under ceiling semantics, a strictly-positive product must round
    // up to 1 atomic unit. With decimals=6, rate=1, and coefficient
    // 4e-7, the true product is 4e-7 atoms. Ceil → 1. The current
    // toFixed(6) rounds 4e-7 down to "0.000000" before the rate is
    // applied and returns 0, silently dropping the billing.
    const evaluator = createPricingEvaluator(
      makeSpec([{ match: "$", capture: "0.0000004" }], { "usdc-sol": 1n }),
    );
    const result = evaluator.capture(OP, requestCtx());
    t.equal(
      result.amount["usdc-sol"],
      1n,
      "4e-7 * 1 = 4e-7 atoms under ceiling semantics → 1",
    );
    t.end();
  },
);

await t.test(
  "coalesce with a parenthesized JSONPath primary still falls back on nil",
  (t) => {
    // The substituteRefs literal-primary check uses `coal.arg.startsWith("$")`
    // to decide whether the primary is a JSONPath reference. A parenthesized
    // form like `coalesce(($.request.body.x), 1)` fails that check and gets
    // treated as a literal, so the outer JSONPATH_REF.replace then substitutes
    // `$.request.body.x` as a mandatory reference and throws when the field
    // is missing — the coalesce's null-safety is silently lost.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(($.request.body.missing), 7)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(
      OP,
      requestCtx({ model: "gpt-4o", messages: [] }),
    );
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      7n,
      "parenthesized JSONPath primary must still coalesce to fallback",
    );
    t.end();
  },
);

await t.test(
  "coalesce with a function-wrapped JSONPath primary still falls back on nil",
  (t) => {
    // Same root cause as the parenthesized case: the arg `jsonSize(...)`
    // doesn't start with `$`, so the literal-inline branch substitutes the
    // jsonSize call as a literal and the outer JSONPATH_REF replace turns
    // the embedded ref into a mandatory lookup that throws on missing data.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(jsonSize($.request.body.missing_items), 42)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(
      OP,
      requestCtx({ model: "gpt-4o", messages: [] }),
    );
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      42n,
      "function-wrapped JSONPath primary must still coalesce to fallback",
    );
    t.end();
  },
);

// Nested coalesce: `coalesce(coalesce($.a, $.b), 99)` is a natural
// "tiered defaults" authoring pattern (prefer explicit override, else
// advertised max, else policy default). The evaluator must resolve
// innermost coalesces first so that by the time an outer coalesce is
// processed, every inner coalesce in its arg/fallback has already
// been reduced to a plain subexpression. A walk that processes the
// outer first would see the inner coalesce text as a flat expression
// and extract refs out of the inner's fallback position, incorrectly
// flipping the outer to its fallback whenever any inner-fallback ref
// was missing.

await t.test(
  "nested coalesce: inner primary resolves, outer uses inner value",
  (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(coalesce($.request.body.a, $.request.body.b), 99)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx({ a: 7 }));
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      7n,
      "inner primary $.a resolves, outer should see 7 (not outer fallback)",
    );
    t.end();
  },
);

await t.test(
  "nested coalesce: inner primary missing, inner fallback resolves",
  (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(coalesce($.request.body.a, $.request.body.b), 99)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx({ b: 11 }));
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      11n,
      "inner fallback $.b resolves to 11, outer should see 11",
    );
    t.end();
  },
);

await t.test(
  "nested coalesce: both inner refs missing, outer fallback applies",
  (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(coalesce($.request.body.a, $.request.body.b), 99)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx({}));
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      99n,
      "both inner refs absent, outer should fall back to 99",
    );
    t.end();
  },
);

await t.test(
  "nested coalesce: inner literal fallback honored when inner ref missing",
  (t) => {
    // `coalesce(coalesce($.a, 5), 99)` with empty body: the inner's
    // literal fallback 5 should be honored, not discarded in favor of
    // the outer's 99. Demonstrates that the bug cascades to inner
    // literal fallbacks — not just ref-to-ref nesting.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "coalesce(coalesce($.request.body.a, 5), 99)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx({}));
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      5n,
      "inner literal fallback 5 must be honored, not discarded for outer 99",
    );
    t.end();
  },
);

await t.test(
  "nested coalesce: triple-nested with only deepest fallback resolving",
  (t) => {
    // Triple nesting `coalesce(coalesce(coalesce($.a, $.b), $.c), 99)`
    // with only `$.c` present. Each outer level must iteratively
    // collapse once its inner has been resolved. Guards against a fix
    // that repairs 2-deep but regresses deeper nesting.
    const spec = makeSpec([
      {
        match: "$",
        authorize:
          "coalesce(coalesce(coalesce($.request.body.a, $.request.body.b), $.request.body.c), 99)",
        capture: "1",
      },
    ]);
    const evaluator = createPricingEvaluator(spec);
    const result = evaluator.authorize(OP, requestCtx({ c: 3 }));
    t.equal(result.matched, true);
    t.equal(
      result.amount["usdc-sol"],
      3n,
      "innermost two coalesces fall back until $.c resolves to 3",
    );
    t.end();
  },
);

await t.test(
  "identifier ending in 'coalesce' is not treated as coalesce()",
  (t) => {
    // `extractCoalesce` / `findInnermostCoalesce` locate coalesce calls
    // by substring match on `coalesce(`. Without a left-boundary check,
    // any identifier whose name ends in `coalesce` — e.g. `mycoalesce`,
    // `precoalesce`, `_coalesce` — would be silently rewritten as a
    // coalesce call, producing a parse-time "valid" expression that
    // evaluates to an unintended number. Construction must reject such
    // expressions loudly.
    t.throws(
      () =>
        createPricingEvaluator(
          makeSpec([
            {
              match: "$",
              authorize: "mycoalesce($.request.body.x, 5)",
              capture: "1",
            },
          ]),
        ),
      /invalid expression/,
      "mycoalesce is not a known parser function",
    );
    t.end();
  },
);
