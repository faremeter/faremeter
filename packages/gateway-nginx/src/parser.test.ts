#!/usr/bin/env pnpm tsx

import t from "tap";
import { extractSpec } from "./parser.js";

const baseDoc = (overrides: Record<string, unknown> = {}) => ({
  openapi: "3.0.0",
  info: { title: "Test", version: "1.0.0" },
  paths: {},
  ...overrides,
});

await t.test("extracts x-faremeter-assets from document root", async (t) => {
  const doc = baseDoc({
    "x-faremeter-assets": {
      USDC: {
        chain: "solana",
        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        decimals: 6,
      },
    },
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage.total" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(Object.keys(result.assets).length, 1);
  t.match(result.assets.USDC, {
    chain: "solana",
    token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  });
  t.end();
});

await t.test("empty assets when none defined", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/test": {
        get: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.count" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(Object.keys(result.assets).length, 0);
  t.end();
});

await t.test("document-level rate cascading", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": { rates: { "input-tokens": 0.003 } },
    paths: {
      "/v1/complete": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.match(result.routes[0], { pricingRules: { "input-tokens": "0.003" } });
  t.end();
});

await t.test("path-level rates override document-level", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": { rates: { "input-tokens": 0.003 } },
    paths: {
      "/v1/expensive": {
        "x-faremeter-pricing": { rates: { "input-tokens": 0.01 } },
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.match(result.routes[0], { pricingRules: { "input-tokens": "0.01" } });
  t.end();
});

await t.test("operation-level rates override path-level", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": { rates: { "input-tokens": 0.003 } },
    paths: {
      "/v1/special": {
        "x-faremeter-pricing": { rates: { "input-tokens": 0.01 } },
        post: {
          "x-faremeter-pricing": {
            rates: { "input-tokens": 0.05 },
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.match(result.routes[0], { pricingRules: { "input-tokens": "0.05" } });
  t.end();
});

await t.test("globalRates reflects document-level rates", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": {
      rates: { "input-tokens": 0.003, "output-tokens": 0.015 },
    },
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.match(result.globalRates, {
    "input-tokens": "0.003",
    "output-tokens": "0.015",
  });
  t.end();
});

await t.test("operations without pricing rules are skipped", async (t) => {
  const doc = baseDoc({
    paths: {
      "/health": {
        get: { summary: "Health check" },
      },
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.match(result.routes[0], { path: "/v1/chat", method: "POST" });
  t.end();
});

await t.test("operations with empty rules array are skipped", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/noop": {
        post: {
          "x-faremeter-pricing": { rules: [] },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 0);
  t.end();
});

await t.test("multiple methods on the same path", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": { rates: { tokens: 0.001 } },
    paths: {
      "/v1/data": {
        get: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.count" }],
          },
        },
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 2);

  const methods = result.routes.map((r) => r.method).sort();
  t.match(methods, ["GET", "POST"]);

  for (const route of result.routes) {
    t.equal(route.path, "/v1/data");
  }
  t.end();
});

await t.test("operation key format is METHOD PATH", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat/completions": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.ok(result.routes[0]);
  t.equal(result.routes[0]?.method, "POST");
  t.equal(result.routes[0]?.path, "/v1/chat/completions");
  t.end();
});

await t.test("SSE transport detection from text/event-stream", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/stream": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
          responses: {
            "200": {
              description: "Streaming response",
              content: {
                "text/event-stream": { schema: { type: "string" } },
              },
            },
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.equal(result.routes[0]?.transportType, "sse");
  t.end();
});

await t.test(
  "default JSON transport when no streaming content type",
  async (t) => {
    const doc = baseDoc({
      paths: {
        "/v1/chat": {
          post: {
            "x-faremeter-pricing": {
              rules: [{ match: "true", capture: "$.response.body.usage" }],
            },
            responses: {
              "200": {
                description: "JSON response",
                content: {
                  "application/json": { schema: { type: "object" } },
                },
              },
            },
          },
        },
      },
    });

    const result = extractSpec(doc);
    t.equal(result.routes.length, 1);
    t.equal(result.routes[0]?.transportType, "json");
    t.end();
  },
);

await t.test("websocket transport from upgrade header parameter", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/ws": {
        get: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.count" }],
          },
          parameters: [
            { name: "Upgrade", in: "header", schema: { type: "string" } },
          ],
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.equal(result.routes[0]?.transportType, "websocket");
  t.end();
});

await t.test("two-phase pricing mode when authorize is present", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [
              {
                match: "model == 'gpt-4'",
                authorize: "100",
                capture: "$.response.body.usage",
              },
            ],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.equal(result.routes[0]?.pricingMode, "two-phase");
  t.end();
});

await t.test("one-phase pricing mode when no authorize", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.body.usage" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes.length, 1);
  t.equal(result.routes[0]?.pricingMode, "one-phase");
  t.end();
});

await t.test("capture fields extracted from rules", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [
              { match: "true", capture: "$.response.body.usage.total_tokens" },
              {
                match: "model == 'gpt-4'",
                capture: "$.response.body.usage.prompt_tokens",
              },
            ],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 2);
  t.match(result.routes[0]?.captureFields[0], {
    path: "$.response.body.usage.total_tokens",
    source: "body",
  });
  t.match(result.routes[0]?.captureFields[1], {
    path: "$.response.body.usage.prompt_tokens",
    source: "body",
  });
  t.end();
});

await t.test("capture fields with header source", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [
              { match: "true", capture: "$.response.headers.x-usage-count" },
            ],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.match(result.routes[0]?.captureFields[0], {
    path: "$.response.headers.x-usage-count",
    source: "headers",
  });
  t.end();
});

await t.test("capture fields with $. prefixed header source", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [
              {
                match: "true",
                capture: "$.response.headers.x-usage-count",
              },
            ],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.match(result.routes[0]?.captureFields[0], {
    path: "$.response.headers.x-usage-count",
    source: "headers",
  });
  t.end();
});

await t.test("capture fields with $. prefixed status source", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [{ match: "true", capture: "$.response.status" }],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.match(result.routes[0]?.captureFields[0], {
    path: "$.response.status",
    source: "status",
  });
  t.end();
});

await t.test("duplicate capture paths are deduplicated", async (t) => {
  const doc = baseDoc({
    paths: {
      "/v1/chat": {
        post: {
          "x-faremeter-pricing": {
            rules: [
              { match: "true", capture: "$.response.body.usage" },
              { match: "model == 'gpt-4'", capture: "$.response.body.usage" },
            ],
          },
        },
      },
    },
  });

  const result = extractSpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.end();
});
