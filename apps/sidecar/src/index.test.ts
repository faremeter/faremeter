#!/usr/bin/env pnpm tsx

import t from "tap";
import type { FaremeterSpec } from "@faremeter/middleware-openapi";
import { createApp } from "./app.js";

const OP = "POST /v1/chat/completions";

function makeSpec(
  rules: NonNullable<FaremeterSpec["operations"][string]["rules"]>,
  rates: Record<string, number> = { "usdc-sol": 1 },
): FaremeterSpec {
  return {
    assets: {
      "usdc-sol": {
        chain: "solana:test",
        token: "TokenAddr",
        decimals: 6,
        recipient: "TestRecipient",
      },
    },
    operations: {
      [OP]: { rates, rules },
    },
  };
}

function requestPayload(
  body: Record<string, unknown> = { model: "gpt-4o", messages: [] },
) {
  return {
    operationKey: OP,
    method: "POST",
    path: "/v1/chat/completions",
    headers: {},
    query: {},
    body,
  };
}

async function post(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  body: unknown,
) {
  const req = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

await t.test("request without payment returns 402 with pricing", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "5000",
      capture: "$.response.body.usage.prompt_tokens * 10",
    },
  ]);
  const { app } = createApp({ spec });

  const res = await post(app, "/request", requestPayload());
  const data = (await res.json()) as Record<string, unknown>;

  t.equal(data.status, 402);
  t.end();
});

await t.test("request with unmatched operation passes through", async (t) => {
  const spec = makeSpec([
    {
      match: '$[?@.request.body.model == "gpt-4o"]',
      authorize: "100",
      capture: "1",
    },
  ]);
  const { app } = createApp({ spec });

  const res = await post(app, "/request", {
    operationKey: "GET /nonexistent",
    method: "GET",
    path: "/nonexistent",
    headers: {},
    query: {},
    body: {},
  });
  const data = (await res.json()) as Record<string, unknown>;

  t.equal(data.status, 200);
  t.end();
});

await t.test("request with null body coerces to empty object", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "100",
      capture: "1",
    },
  ]);
  const { app } = createApp({ spec });

  const res = await post(app, "/request", {
    operationKey: OP,
    method: "POST",
    path: "/v1/chat/completions",
    headers: {},
    query: {},
    body: null,
  });
  const data = (await res.json()) as Record<string, unknown>;

  t.equal(data.status, 402);
  t.end();
});

await t.test("response evaluates capture and returns amount", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "5000",
      capture:
        "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
    },
  ]);
  const { app } = createApp({ spec });

  const res = await post(app, "/response", {
    ...requestPayload(),
    response: {
      status: 200,
      headers: {},
      body: {
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
    },
  });
  const data = (await res.json()) as Record<string, unknown>;

  t.equal(data.captured, true);
  const amount = data.amount as Record<string, unknown>;
  t.equal(amount["usdc-sol"], "2500");
  t.end();
});

await t.test("response with no matching operation returns empty", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "100",
      capture: "$.response.body.usage.total_tokens",
    },
  ]);
  const { app } = createApp({ spec });

  const res = await post(app, "/response", {
    operationKey: "GET /nonexistent",
    method: "GET",
    path: "/nonexistent",
    headers: {},
    query: {},
    body: {},
    response: {
      status: 200,
      headers: {},
      body: { usage: { total_tokens: 100 } },
    },
  });
  const data = (await res.json()) as Record<string, unknown>;

  t.equal(data.captured, false);
  t.end();
});

await t.test("invalid request body returns 400", async (t) => {
  const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
  const { app } = createApp({ spec });

  const res = await post(app, "/request", { bad: "payload" });
  t.equal(res.status, 400);
  t.end();
});
