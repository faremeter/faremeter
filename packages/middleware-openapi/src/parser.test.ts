#!/usr/bin/env pnpm tsx

import t from "tap";
import { extractSpec } from "./parser";

await t.test("extractSpec extracts assets from document root", (t) => {
  const doc = {
    "x-faremeter-assets": {
      "usdc-sol": {
        chain: "solana:test",
        token: "TokenAddr",
        decimals: 6,
        recipient: "TestRecipient",
      },
    },
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {},
  };

  const spec = extractSpec(doc);
  t.same(spec.assets, {
    "usdc-sol": {
      chain: "solana:test",
      token: "TokenAddr",
      decimals: 6,
      recipient: "TestRecipient",
    },
  });
  t.end();
});

await t.test("extractSpec resolves rates from document root", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.same(spec.operations["POST /test"]?.rates, { "usdc-sol": 1 });
  t.end();
});

await t.test("extractSpec path-level rates override document rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        "x-faremeter-pricing": { rates: { "usdc-base": 2 } },
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.same(spec.operations["POST /test"]?.rates, { "usdc-base": 2 });
  t.end();
});

await t.test("extractSpec operation-level rates override path rates", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        "x-faremeter-pricing": { rates: { "usdc-base": 2 } },
        post: {
          "x-faremeter-pricing": {
            rates: { "usdc-arb": 3 },
            rules: [{ match: "true", capture: "1" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.same(spec.operations["POST /test"]?.rates, { "usdc-arb": 3 });
  t.end();
});

await t.test("extractSpec skips operations without rules", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        post: {
          "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.equal(Object.keys(spec.operations).length, 0);
  t.end();
});

await t.test("extractSpec handles multiple methods on the same path", (t) => {
  const doc = {
    "x-faremeter-pricing": { rates: { "usdc-sol": 1 } },
    paths: {
      "/test": {
        get: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "1" }],
          },
        },
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "2" }],
          },
        },
      },
    },
  };

  const spec = extractSpec(doc);
  t.ok(spec.operations["GET /test"]);
  t.ok(spec.operations["POST /test"]);
  t.equal(spec.operations["GET /test"]?.rules?.[0]?.capture, "1");
  t.equal(spec.operations["POST /test"]?.rules?.[0]?.capture, "2");
  t.end();
});
