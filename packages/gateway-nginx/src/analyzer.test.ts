#!/usr/bin/env pnpm tsx

import t from "tap";
import { analyzeRule, extractResponseRefs } from "./analyzer.js";

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
  t.equal(result.captureFields[1]?.path, "$.response.body.usage.prompt_tokens");
  t.end();
});

await t.test("nested body refs are both captured", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture:
      "$.response.body.usage.prompt_tokens + $.response.body.usage.completion_tokens",
  });

  t.equal(result.captureFields.length, 2);
  t.equal(result.captureFields[0]?.path, "$.response.body.usage.prompt_tokens");
  t.equal(
    result.captureFields[1]?.path,
    "$.response.body.usage.completion_tokens",
  );
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

await t.test(
  "extractResponseRefs returns refs in source order with duplicates",
  async (t) => {
    // extractResponseRefs is the raw extractor — deduplication is
    // analyzeRule's job (see "analyzeRule deduplicates field refs"
    // below). Pinning the duplicate-preserving behavior here guards
    // against a future refactor that folds dedup into the extractor
    // and breaks analyzeRule's dedup test by accident.
    const refs = extractResponseRefs(
      "$.response.body.x + $.response.body.x * 2",
    );
    t.equal(refs.length, 2);
    t.equal(refs[0], "$.response.body.x");
    t.equal(refs[1], "$.response.body.x");
    t.end();
  },
);

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

await t.test(
  "analyzeRule rejects wildcard capture paths instead of silently truncating",
  async (t) => {
    // `$.response.body.items[*].count` is a JSONPath wildcard. The
    // regex-based ref extractor stops at the `[` and returns
    // `$.response.body.items` — silently capturing the whole array
    // instead of the per-item counts the author asked for. Reject
    // at construction so the spec author sees the unsupported
    // syntax immediately.
    t.throws(
      () =>
        analyzeRule({
          match: "$",
          authorize: "1",
          capture: "$.response.body.items[*].count",
        }),
      /wildcard|\[\*\]|unsupported/i,
      "wildcard capture path must be rejected at construction",
    );
    t.end();
  },
);

await t.test("request-only refs in capture are ignored", async (t) => {
  const result = analyzeRule({
    match: "$[?@.request.method == 'POST']",
    authorize: "1",
    capture: "$.request.body.tokens",
  });

  t.equal(result.captureFields.length, 0);
  t.end();
});

// Leaf-vs-subtree conflict detection. Capturing a path as a leaf AND
// capturing deeper fields within that same subtree is semantically
// contradictory: the Lua reconstructor in `fm.reconstruct_nested`
// would emit one or the other depending on iteration order. The
// check fails the spec at config-generation time with a specific
// pointer at the conflicting paths.

await t.test(
  "analyzeRule rejects leaf-vs-subtree capture path conflict (leaf first)",
  async (t) => {
    // Capturing `usage` (as a leaf) and `usage.total_tokens` (inside
    // that subtree) is semantically contradictory: the Lua
    // reconstructor would emit one or the other depending on
    // iteration order. Fail at gen time with a specific error.
    t.throws(
      () =>
        analyzeRule({
          match: "$",
          authorize: "1",
          capture: "$.response.body.usage + $.response.body.usage.total_tokens",
        }),
      /conflict/,
    );
    t.end();
  },
);

await t.test(
  "analyzeRule rejects leaf-vs-subtree capture path conflict (deeper first)",
  async (t) => {
    // Same conflict reported in the reverse listing order — the
    // deeper path appears before its ancestor in the capture
    // expression. The check must be order-independent.
    t.throws(
      () =>
        analyzeRule({
          match: "$",
          authorize: "1",
          capture: "$.response.body.usage.total_tokens + $.response.body.usage",
        }),
      /conflict/,
    );
    t.end();
  },
);

await t.test(
  "analyzeRule accepts sibling capture paths with shared prefix",
  async (t) => {
    // `usage.prompt_tokens` and `usage.completion_tokens` share the
    // `usage.` prefix but are both leaves — no conflict. Guards
    // against a too-eager prefix check that rejects legitimate
    // sibling paths.
    const result = analyzeRule({
      match: "$",
      authorize: "1",
      capture:
        "$.response.body.usage.prompt_tokens + $.response.body.usage.completion_tokens",
    });
    t.equal(result.captureFields.length, 2);
    t.end();
  },
);

await t.test(
  "analyzeRule rejects bare $.response.body capture with a specific error",
  async (t) => {
    // `$.response.body` by itself — with no field suffix — would
    // ask the Lua runtime to capture the entire body as one value.
    // The downstream `bodyFieldPath` helper rejects this shape at
    // Lua-file generation time with a message mentioning an
    // internal helper name, which is a poor error surface for a
    // spec author. Catch it up front with a message that points at
    // the path shape directly.
    t.throws(
      () =>
        analyzeRule({
          match: "$",
          authorize: "1",
          capture: "$.response.body",
        }),
      /capture path .* must reference a specific field/,
    );
    t.end();
  },
);

await t.test(
  "analyzeRule accepts paths that share a leading segment but differ",
  async (t) => {
    // `usage` vs `usages` — not a prefix relationship even as
    // substrings (distinct final segments). Guards against a naive
    // `startsWith(shorter)` check that ignores segment boundaries.
    const result = analyzeRule({
      match: "$",
      authorize: "1",
      capture: "$.response.body.usage + $.response.body.usages",
    });
    t.equal(result.captureFields.length, 2);
    t.end();
  },
);
