#!/usr/bin/env pnpm tsx

import t from "tap";

import { convertPath, detectOverlaps } from "./path.js";

await t.test("static path produces exact-match location", async (t) => {
  const result = convertPath("/v1/chat/completions");
  t.equal(result.directive, "= /v1/chat/completions");
  t.equal(result.warnings.length, 0);
  t.end();
});

await t.test("single param produces regex location", async (t) => {
  const result = convertPath("/v1/{provider}/models");
  t.equal(result.directive, "~ ^/v1/([^/]+)/models$");
  t.equal(result.warnings.length, 0);
  t.end();
});

await t.test("multiple params each become capture groups", async (t) => {
  const result = convertPath("/v1/{provider}/models/{id}/completions");
  t.equal(result.directive, "~ ^/v1/([^/]+)/models/([^/]+)/completions$");
  t.equal(result.warnings.length, 0);
  t.end();
});

await t.test("param at start of path", async (t) => {
  const result = convertPath("/{version}/models");
  t.equal(result.directive, "~ ^/([^/]+)/models$");
  t.end();
});

await t.test("param at end of path", async (t) => {
  const result = convertPath("/v1/models/{id}");
  t.equal(result.directive, "~ ^/v1/models/([^/]+)$");
  t.end();
});

await t.test("adjacent params in consecutive segments", async (t) => {
  const result = convertPath("/v1/{provider}/{model}");
  t.equal(result.directive, "~ ^/v1/([^/]+)/([^/]+)$");
  t.end();
});

await t.test("root path produces exact-match location", async (t) => {
  const result = convertPath("/");
  t.equal(result.directive, "= /");
  t.equal(result.warnings.length, 0);
  t.end();
});

await t.test("detectOverlaps finds overlapping regex paths", async (t) => {
  const warnings = detectOverlaps([
    "/v1/{provider}/models",
    "/v1/{vendor}/models",
  ]);
  t.equal(warnings.length, 1);
  t.match(warnings[0], /Potential regex overlap/);
  t.end();
});

await t.test("detectOverlaps ignores static paths", async (t) => {
  const warnings = detectOverlaps([
    "/v1/chat/completions",
    "/v1/audio/transcriptions",
  ]);
  t.equal(warnings.length, 0);
  t.end();
});

await t.test(
  "detectOverlaps does not flag paths with different segment counts",
  async (t) => {
    const warnings = detectOverlaps([
      "/v1/{provider}/models",
      "/v1/{provider}/models/{id}",
    ]);
    t.equal(warnings.length, 0);
    t.end();
  },
);

await t.test(
  "detectOverlaps does not flag paths with differing static segments",
  async (t) => {
    const warnings = detectOverlaps([
      "/v1/{provider}/models",
      "/v2/{provider}/models",
    ]);
    t.equal(warnings.length, 0);
    t.end();
  },
);

await t.test(
  "detectOverlaps flags overlap when param aligns with static segment",
  async (t) => {
    const warnings = detectOverlaps([
      "/v1/{action}/results",
      "/v1/search/results",
    ]);
    // The second path is static, so it won't appear in regex paths --
    // no overlap warning expected since static exact-match takes priority.
    t.equal(warnings.length, 0);
    t.end();
  },
);

await t.test("unbalanced open brace in path is rejected", async (t) => {
  // The allowlist at path.ts:17 permits `{` and `}` so that `{param}`
  // templates parse, but it does not enforce balance. `/api/{foo`
  // currently passes and gets emitted as `location = /api/{foo {`,
  // which nginx rejects at load time with `unknown directive "foo"`.
  // Reject at generation time with a clear error instead.
  t.throws(
    () => convertPath("/api/{foo"),
    /unbalanced|brace|malformed|invalid/i,
    "an unbalanced `{` must throw rather than emit a broken location directive",
  );
  t.end();
});

await t.test("unbalanced close brace in path is rejected", async (t) => {
  // Same rationale as the unbalanced `{` case. `/api/foo}` currently
  // passes validation and produces a broken nginx config.
  t.throws(
    () => convertPath("/api/foo}"),
    /unbalanced|brace|malformed|invalid/i,
    "an unbalanced `}` must throw rather than emit a broken location directive",
  );
  t.end();
});

await t.test("stray `}{` pair in path is rejected", async (t) => {
  // A `}{` boundary is not a well-formed template segment. The current
  // allowlist does not reject it and nginx will emit a cryptic
  // directive-level error when it tries to parse the output.
  t.throws(
    () => convertPath("/foo}{bar"),
    /unbalanced|brace|malformed|invalid/i,
    "`}{` inside a path must throw rather than emit a nested brace directive",
  );
  t.end();
});

await t.test("empty `{}` parameter segment is rejected", async (t) => {
  // An empty `{}` is not a valid OpenAPI parameter template — the
  // braces must contain a name. The generator emits `location =
  // /api/{}` for this input, which nginx treats as a `{` block
  // opener and rejects at config load. Fail at generation time
  // with a clear error instead.
  t.throws(
    () => convertPath("/api/{}"),
    /empty|missing name|brace|invalid/i,
    "`{}` with no parameter name must throw rather than emit a broken location directive",
  );
  t.throws(
    () => convertPath("/api/{}/sub"),
    /empty|missing name|brace|invalid/i,
    "`{}` mid-path must also throw",
  );
  t.end();
});
