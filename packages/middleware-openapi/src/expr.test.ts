#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  extractCoalesce,
  extractPlainRefs,
  findInnermostCoalesce,
  findJSONSizeRefs,
} from "./expr";

// --- extractCoalesce ---------------------------------------------------

await t.test("extractCoalesce parses balanced parentheses", (t) => {
  const result = extractCoalesce("coalesce($.response.body.x, 0)");
  t.ok(result);
  t.equal(result?.arg, "$.response.body.x");
  t.equal(result?.fallback, "0");
  t.equal(result?.start, 0);
  t.equal(result?.end, "coalesce($.response.body.x, 0)".length);
  t.end();
});

await t.test("extractCoalesce handles nested function calls in arg", (t) => {
  const result = extractCoalesce("coalesce(fn($.response.body.x), 0)");
  t.ok(result);
  t.equal(result?.arg, "fn($.response.body.x)");
  t.equal(result?.fallback, "0");
  t.end();
});

await t.test(
  "extractCoalesce handles nested function calls in fallback",
  (t) => {
    const result = extractCoalesce("coalesce($.request.body.x, fn(1, 2))");
    t.ok(result);
    t.equal(result?.arg, "$.request.body.x");
    t.equal(result?.fallback, "fn(1, 2)");
    t.end();
  },
);

await t.test("extractCoalesce returns null for no coalesce", (t) => {
  t.equal(extractCoalesce("$.response.body.x * 2"), null);
  t.equal(extractCoalesce("max(1, 2)"), null);
  t.equal(extractCoalesce(""), null);
  t.end();
});

await t.test("extractCoalesce returns null for unclosed paren", (t) => {
  // An opening `coalesce(` without a matching closing paren is a
  // syntax error. The balance walker must not hallucinate a match.
  t.equal(extractCoalesce("coalesce($.a, 5"), null);
  t.equal(extractCoalesce("coalesce($.a"), null);
  t.equal(extractCoalesce("coalesce("), null);
  t.end();
});

await t.test("extractCoalesce returns null for missing comma", (t) => {
  // `coalesce` requires exactly two positional args. A one-arg call
  // is neither valid nor should it be silently rewritten.
  t.equal(extractCoalesce("coalesce($.a)"), null);
  t.equal(extractCoalesce("coalesce(5)"), null);
  t.end();
});

await t.test("extractCoalesce finds coalesce after leading text", (t) => {
  const result = extractCoalesce("1 + coalesce($.a, 0) * 2");
  t.ok(result);
  t.equal(result?.arg, "$.a");
  t.equal(result?.fallback, "0");
  t.equal(result?.start, 4);
  t.equal(result?.end, 4 + "coalesce($.a, 0)".length);
  t.end();
});

await t.test("extractCoalesce skips identifiers ending in 'coalesce'", (t) => {
  // Without the left-boundary check, any identifier whose name
  // ends in `coalesce` would be matched as a coalesce call. This
  // test pins the guard that prevents that silent misrewriting.
  t.equal(extractCoalesce("mycoalesce($.a, 5)"), null);
  t.equal(extractCoalesce("precoalesce($.a, 5)"), null);
  t.equal(extractCoalesce("_coalesce($.a, 5)"), null);
  t.equal(extractCoalesce("0coalesce($.a, 5)"), null);
  t.equal(extractCoalesce("$coalesce($.a, 5)"), null);
  t.end();
});

await t.test(
  "extractCoalesce finds a genuine coalesce after a prefixed false positive",
  (t) => {
    // The scanner must keep searching after skipping a false
    // positive. Here `mycoalesce` is a typo-shaped identifier, but
    // a real `coalesce(` follows it on the same line.
    const result = extractCoalesce("mycoalesce(x) + coalesce($.a, 0)");
    t.ok(result);
    t.equal(result?.arg, "$.a");
    t.equal(result?.fallback, "0");
    t.end();
  },
);

await t.test(
  "extractCoalesce finds a genuine coalesce wrapping an inner false positive",
  (t) => {
    // Innermost-first is the job of `findInnermostCoalesce`, but
    // `extractCoalesce` itself should still return the outer
    // coalesce when the inner text is a false-positive identifier.
    const result = extractCoalesce("coalesce(mycoalesce(x), 99)");
    t.ok(result);
    t.equal(result?.arg, "mycoalesce(x)");
    t.equal(result?.fallback, "99");
    t.end();
  },
);

// --- findInnermostCoalesce --------------------------------------------

await t.test(
  "findInnermostCoalesce returns the only coalesce in a flat expression",
  (t) => {
    const result = findInnermostCoalesce("coalesce($.a, 5)");
    t.ok(result);
    t.equal(result?.arg, "$.a");
    t.equal(result?.fallback, "5");
    t.end();
  },
);

await t.test("findInnermostCoalesce returns null for no coalesce", (t) => {
  t.equal(findInnermostCoalesce("$.a + 1"), null);
  t.equal(findInnermostCoalesce(""), null);
  t.end();
});

await t.test(
  "findInnermostCoalesce returns the inner of a 2-deep nested pair",
  (t) => {
    // `coalesce(coalesce($.a, $.b), 99)` — the inner coalesce is
    // the one that must be collapsed first.
    const result = findInnermostCoalesce("coalesce(coalesce($.a, $.b), 99)");
    t.ok(result);
    t.equal(result?.arg, "$.a");
    t.equal(result?.fallback, "$.b");
    t.end();
  },
);

await t.test(
  "findInnermostCoalesce returns the deepest of a 3-deep nested chain",
  (t) => {
    const result = findInnermostCoalesce(
      "coalesce(coalesce(coalesce($.a, $.b), $.c), 99)",
    );
    t.ok(result);
    t.equal(result?.arg, "$.a");
    t.equal(result?.fallback, "$.b");
    t.end();
  },
);

await t.test(
  "findInnermostCoalesce handles a nested coalesce in the fallback position",
  (t) => {
    // `coalesce($.a, coalesce($.b, $.c))` — the inner is on the
    // fallback side of the outer. Should still be found.
    const result = findInnermostCoalesce("coalesce($.a, coalesce($.b, $.c))");
    t.ok(result);
    t.equal(result?.arg, "$.b");
    t.equal(result?.fallback, "$.c");
    t.end();
  },
);

await t.test(
  "findInnermostCoalesce ignores identifiers ending in 'coalesce' in the primary",
  (t) => {
    // The arg contains `mycoalesce(...)` which is a false positive.
    // findInnermostCoalesce must classify this outer as innermost
    // (its arg and fallback contain no *real* coalesce), not as
    // having a nested one.
    const result = findInnermostCoalesce("coalesce(mycoalesce(x), 99)");
    t.ok(result);
    t.equal(result?.arg, "mycoalesce(x)");
    t.equal(result?.fallback, "99");
    t.end();
  },
);

await t.test(
  "findInnermostCoalesce reports absolute offsets into the original expression",
  (t) => {
    // The returned `start`/`end` must point into the original
    // string, not the internal `sub` slice used during scanning.
    // Verifies the cursor-offset bookkeeping.
    const expr = "1 + coalesce(coalesce($.a, $.b), 99) * 2";
    const result = findInnermostCoalesce(expr);
    t.ok(result);
    t.equal(result?.arg, "$.a");
    t.equal(result?.fallback, "$.b");
    t.equal(expr.slice(result?.start, result?.end), "coalesce($.a, $.b)");
    t.end();
  },
);

// --- extractPlainRefs --------------------------------------------------

await t.test("extractPlainRefs returns empty list for no refs", (t) => {
  t.same(extractPlainRefs("1 + 2"), []);
  t.same(extractPlainRefs(""), []);
  t.end();
});

await t.test("extractPlainRefs returns refs in source order", (t) => {
  t.same(extractPlainRefs("$.a + $.b * $.c"), ["$.a", "$.b", "$.c"]);
  t.end();
});

await t.test("extractPlainRefs preserves duplicates", (t) => {
  // Deduplication is a downstream concern. The extractor must not
  // silently collapse duplicates — some callers count occurrences.
  t.same(extractPlainRefs("$.a + $.a * 2"), ["$.a", "$.a"]);
  t.end();
});

await t.test("extractPlainRefs handles bracket notation", (t) => {
  t.same(extractPlainRefs("$['a.b'] + $.c[0] + $.d"), [
    "$['a.b']",
    "$.c[0]",
    "$.d",
  ]);
  t.end();
});

// --- findJSONSizeRefs --------------------------------------------------

await t.test("findJSONSizeRefs finds a single jsonSize call", (t) => {
  t.same(findJSONSizeRefs("jsonSize($.response.body)"), ["$.response.body"]);
  t.end();
});

await t.test("findJSONSizeRefs ignores unrelated function calls", (t) => {
  t.same(findJSONSizeRefs("max($.a, jsonSize($.b))"), ["$.b"]);
  t.end();
});

await t.test("findJSONSizeRefs returns empty for no jsonSize", (t) => {
  t.same(findJSONSizeRefs("$.a + 1"), []);
  t.end();
});
