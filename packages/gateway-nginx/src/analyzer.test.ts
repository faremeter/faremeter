#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  analyzeRule,
  extractCoalesce,
  extractResponseRefs,
  buildReconstructionMap,
} from "./analyzer.js";

await t.test("extractCoalesce parses balanced parentheses", async (t) => {
  const result = extractCoalesce("coalesce($.response.body.x, 0)");
  t.ok(result);
  t.equal(result?.arg, "$.response.body.x");
  t.equal(result?.fallback, "0");
  t.end();
});

await t.test("extractCoalesce handles nested function calls", async (t) => {
  const result = extractCoalesce("coalesce(fn($.response.body.x), 0)");
  t.ok(result);
  t.equal(result?.arg, "fn($.response.body.x)");
  t.equal(result?.fallback, "0");
  t.end();
});

await t.test("extractCoalesce returns null for no coalesce", async (t) => {
  const result = extractCoalesce("$.response.body.x * 2");
  t.equal(result, null);
  t.end();
});

await t.test("simple body ref extraction", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "$.request.body.tokens",
    capture: "$.response.body.usage.total_tokens",
  });

  t.equal(result.pricingMode, "two-phase");
  t.equal(result.captureFields.length, 1);
  t.equal(result.captureFields[0]?.path, "$.response.body.usage.total_tokens");
  t.equal(result.captureFields[0]?.source, "body");
  t.equal(result.captureFields[0]?.optional, false);
  t.end();
});

await t.test("coalesce with ref primary and literal fallback", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture: "coalesce($.response.body.usage.total_tokens, 0)",
  });

  t.equal(result.captureFields.length, 1);
  t.equal(result.captureFields[0]?.path, "$.response.body.usage.total_tokens");
  t.equal(result.captureFields[0]?.optional, true);
  t.end();
});

await t.test("coalesce with ref primary and ref fallback", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture:
      "coalesce($.response.body.usage.total_tokens, $.response.body.usage.prompt_tokens)",
  });

  t.equal(result.captureFields.length, 2);
  t.equal(result.captureFields[0]?.path, "$.response.body.usage.total_tokens");
  t.equal(result.captureFields[0]?.optional, true);
  t.equal(result.captureFields[1]?.path, "$.response.body.usage.prompt_tokens");
  t.equal(result.captureFields[1]?.optional, false);
  t.end();
});

await t.test("nested body refs build reconstruction map", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture:
      "$.response.body.usage.prompt_tokens + $.response.body.usage.completion_tokens",
  });

  t.equal(result.captureFields.length, 2);
  t.matchOnly(result.reconstructionMap, {
    usage: {
      prompt_tokens: true,
      completion_tokens: true,
    },
  });
  t.end();
});

await t.test("header refs classified as headers", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'GET']",
    authorize: "1",
    capture: "$.response.headers.x-ratelimit-remaining",
  });

  t.equal(result.captureFields.length, 1);
  t.equal(result.captureFields[0]?.source, "headers");
  t.equal(
    result.captureFields[0]?.path,
    "$.response.headers.x-ratelimit-remaining",
  );
  t.end();
});

await t.test("status ref classified as status", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'GET']",
    authorize: "1",
    capture: "$.response.status",
  });

  t.equal(result.captureFields.length, 1);
  t.equal(result.captureFields[0]?.source, "status");
  t.equal(result.captureFields[0]?.path, "$.response.status");
  t.end();
});

await t.test("jsonSize on response ref is rejected", async (t) => {
  t.throws(
    () =>
      analyzeRule({
        match: "$[?@.request.method == 'POST']",
        authorize: "1",
        capture: "jsonSize($.response.body)",
      }),
    {
      message:
        /jsonSize\(\$\.response\.body\) is not supported in capture expressions/,
    },
  );
  t.end();
});

await t.test("one-phase detection when authorize is absent", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'GET']",
    capture: "1",
  });

  t.equal(result.pricingMode, "one-phase");
  t.equal(result.captureFields.length, 0);
  t.end();
});

await t.test(
  "one-phase capture-only rule referencing response is accepted",
  async (t) => {
    const result = analyzeRule({
      match: "$[?@.request.method == 'POST']",
      capture: "$.response.body.usage.total_tokens",
    });
    t.equal(result.pricingMode, "one-phase");
    t.equal(result.captureFields.length, 1);
    t.match(result.captureFields[0], {
      path: "$.response.body.usage.total_tokens",
      source: "body",
    });
    t.end();
  },
);

await t.test("extractResponseRefs deduplicates refs", async (t) => {
  const refs = extractResponseRefs("$.response.body.x + $.response.body.x * 2");
  t.equal(refs.length, 2);
  t.equal(refs[0]?.ref, "$.response.body.x");
  t.equal(refs[1]?.ref, "$.response.body.x");
  t.end();
});

await t.test("analyzeRule deduplicates field refs", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture: "$.response.body.x + $.response.body.x * 2",
  });

  t.equal(result.captureFields.length, 1);
  t.equal(result.captureFields[0]?.path, "$.response.body.x");
  t.end();
});

await t.test("buildReconstructionMap with deep nesting", async (t) => {
  const map = buildReconstructionMap([
    { path: "$.response.body.a.b.c", source: "body", optional: false },
    { path: "$.response.body.a.b.d", source: "body", optional: false },
    { path: "$.response.body.a.e", source: "body", optional: false },
  ]);

  t.matchOnly(map, {
    a: {
      b: {
        c: true,
        d: true,
      },
      e: true,
    },
  });
  t.end();
});

await t.test("buildReconstructionMap ignores non-body fields", async (t) => {
  const map = buildReconstructionMap([
    { path: "$.response.body.x", source: "body", optional: false },
    {
      path: "$.response.headers.content-type",
      source: "headers",
      optional: false,
    },
    { path: "$.response.status", source: "status", optional: false },
  ]);

  t.matchOnly(map, { x: true });
  t.end();
});

await t.test("request-only refs in capture are ignored", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture: "$.request.body.tokens",
  });

  t.equal(result.captureFields.length, 0);
  t.matchOnly(result.reconstructionMap, {});
  t.end();
});
