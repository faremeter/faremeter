#!/usr/bin/env pnpm tsx

import t from "tap";
import { extractGatewaySpec } from "./parser.js";

const baseDoc = (overrides: Record<string, unknown> = {}) => ({
  openapi: "3.0.0",
  info: { title: "Test", version: "1.0.0" },
  paths: {},
  ...overrides,
});

await t.test("routes carry resolved rates as strings", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": { rates: { "input-tokens": 3 } },
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

  const result = extractGatewaySpec(doc);
  t.equal(result.routes.length, 1);
  t.match(result.routes[0], { pricingRules: { "input-tokens": "3" } });
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

  const result = extractGatewaySpec(doc);
  t.equal(result.routes.length, 1);
  t.match(result.routes[0], { path: "/v1/chat", method: "POST" });
  t.end();
});

await t.test("multiple methods on the same path", async (t) => {
  const doc = baseDoc({
    "x-faremeter-pricing": { rates: { tokens: 1 } },
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

  const result = extractGatewaySpec(doc);
  t.equal(result.routes.length, 2);

  const methods = result.routes.map((r) => r.method).sort();
  t.match(methods, ["GET", "POST"]);

  for (const route of result.routes) {
    t.equal(route.path, "/v1/data");
  }
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

  const result = extractGatewaySpec(doc);
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

    const result = extractGatewaySpec(doc);
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

  const result = extractGatewaySpec(doc);
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

  const result = extractGatewaySpec(doc);
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

  const result = extractGatewaySpec(doc);
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

  const result = extractGatewaySpec(doc);
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

  const result = extractGatewaySpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.match(result.routes[0]?.captureFields[0], {
    path: "$.response.headers.x-usage-count",
    source: "headers",
  });
  t.end();
});

await t.test("capture fields with status source", async (t) => {
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

  const result = extractGatewaySpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.match(result.routes[0]?.captureFields[0], {
    path: "$.response.status",
    source: "status",
  });
  t.end();
});

await t.test(
  "operation with x-faremeter-pricing but no rules at any level produces no routes",
  async (t) => {
    // No rules at any level — the operation is not priced and
    // produces no routes.
    const doc = baseDoc({
      paths: {
        "/v1/chat": {
          post: {
            "x-faremeter-pricing": {
              rates: { tokens: 1 },
            },
          },
        },
      },
    });
    const spec = extractGatewaySpec(doc);
    t.equal(spec.routes.length, 0);
    t.end();
  },
);

await t.test(
  "ParsedSpec does not expose the dead globalRates field",
  async (t) => {
    // `toParsedSpec` populates `globalRates` from the first
    // operation's rates — not actually global, just the first op
    // masquerading as global — and no consumer reads it. Either
    // remove the field or populate it from a legitimate global
    // source (document-level `x-faremeter-pricing.rates`).
    const doc = baseDoc({
      "x-faremeter-pricing": { rates: { tokens: 1 } },
      paths: {
        "/v1/chat": {
          post: {
            "x-faremeter-pricing": {
              rules: [{ match: "true", capture: "1" }],
            },
          },
        },
      },
    });
    const result = extractGatewaySpec(doc);
    t.notOk(
      "globalRates" in result,
      "ParsedSpec must not expose globalRates (dead field)",
    );
    t.end();
  },
);

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

  const result = extractGatewaySpec(doc);
  t.equal(result.routes[0]?.captureFields.length, 1);
  t.end();
});
