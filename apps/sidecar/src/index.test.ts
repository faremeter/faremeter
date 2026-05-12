#!/usr/bin/env pnpm tsx

import t from "tap";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type {
  FaremeterSpec,
  HandlerBinding,
  PricingRule,
} from "@faremeter/middleware-openapi";
import { createApp, createMultiSiteApp } from "./app.js";

const OP = "POST /v1/chat/completions";

const DEFAULT_ASSETS = {
  "usdc-sol": {
    chain: "solana:test",
    token: "TokenAddr",
    decimals: 6,
    recipient: "TestRecipient",
  },
};

function makeSpec(): FaremeterSpec {
  return {
    assets: DEFAULT_ASSETS,
    operations: {
      [OP]: { method: "POST", path: "/v1/chat/completions", transport: "json" },
    },
  };
}

function makeStubHandler(scheme = "test"): FacilitatorHandler {
  return {
    capabilities: {
      schemes: [scheme],
      networks: ["solana:test"],
      assets: ["TokenAddr"],
    },
    getRequirements: async ({ accepts }) => accepts,
    handleSettle: async () => null,
  };
}

function makeBinding(
  rules: PricingRule[],
  rates: Record<string, bigint> = { "usdc-sol": 1n },
): HandlerBinding {
  return {
    handler: makeStubHandler(),
    operations: { [OP]: { rates, rules } },
  };
}

const BASE_URL = "http://test-gateway";

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
  const bindings = [
    makeBinding([
      {
        match: "$",
        authorize: "5000",
        capture: "$.response.body.usage.prompt_tokens * 10",
      },
    ]),
  ];
  const { app } = createApp({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
  });

  const res = await post(app, "/request", requestPayload());
  const data = (await res.json()) as Record<string, unknown>;

  t.equal(data.status, 402);
  t.end();
});

await t.test("request with unmatched operation passes through", async (t) => {
  const bindings = [
    makeBinding([
      {
        match: '$[?@.request.body.model == "gpt-4o"]',
        authorize: "100",
        capture: "1",
      },
    ]),
  ];
  const { app } = createApp({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
  });

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

await t.test(
  "request with null body is rejected at the handler boundary",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });

    const res = await post(app, "/request", {
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
      query: {},
      body: null,
    });
    const data = (await res.json()) as Record<string, unknown>;

    t.equal(res.status, 200);
    t.equal(data.status, 500);
    t.end();
  },
);

await t.test(
  "response returns 500 for two-phase rule when settlement fails",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "5000",
          capture:
            "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
        },
      ]),
    ];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });

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
    t.equal(res.status, 500, "transport status must be non-2xx for Lua retry");
    const data = (await res.json()) as Record<string, unknown>;

    t.equal(data.status, 500);
    t.end();
  },
);

await t.test("response with no matching operation returns empty", async (t) => {
  const bindings = [
    makeBinding([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]),
  ];
  const { app } = createApp({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
  });

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

  t.equal(data.status, 200);
  t.end();
});

await t.test(
  "onCapture does not fire when no bindings are configured",
  async (t) => {
    let hookFired = false;
    const { app } = createApp({
      spec: makeSpec(),
      baseURL: BASE_URL,
      onCapture: () => {
        hookFired = true;
      },
    });

    const res = await post(app, "/response", {
      ...requestPayload(),
      response: {
        status: 200,
        headers: {},
        body: { usage: { total_tokens: 50 } },
      },
    });
    // Without bindings the gateway passes through unpaid; the response
    // phase has nothing to settle, so it returns 200 from the handler.
    // The sidecar then echoes that as transport 200.
    t.equal(res.status, 200);
    t.equal(
      hookFired,
      false,
      "hook does not fire when no bindings are configured",
    );
    t.end();
  },
);

await t.test(
  "onCapture does not fire for two-phase rule when settlement fails",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.usage.total_tokens * 2",
        },
      ]),
    ];
    const calls: { key: string; amount: unknown }[] = [];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
      onCapture: (operationKey, result) => {
        calls.push({ key: operationKey, amount: result.amount });
      },
    });

    const res = await post(app, "/response", {
      ...requestPayload(),
      response: {
        status: 200,
        headers: {},
        body: { usage: { total_tokens: 50 } },
      },
    });

    // No payment header was provided, so the middleware never invokes
    // the body callback. The transport is 500 because the response
    // phase needs settlement that never happens, but onCapture is
    // gated on settlementAttempted which never goes true.
    t.equal(res.status, 500);
    t.equal(
      calls.length,
      0,
      "hook must not fire when no payment was dispatched",
    );
    t.end();
  },
);

await t.test("onCapture does not fire on validation error", async (t) => {
  const bindings = [
    makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
  ];
  let fired = false;
  const { app } = createApp({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
    onCapture: () => {
      fired = true;
    },
  });

  const res = await post(app, "/response", { bad: "payload" });
  t.equal(
    res.status,
    500,
    "validation failure on /response must return non-2xx (see K2 comment in app.ts)",
  );
  t.equal(fired, false, "hook not called when validation fails");
  t.end();
});

await t.test("onCapture does not fire when no operation matches", async (t) => {
  const bindings = [
    makeBinding([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]),
  ];
  let fired = false;
  const { app } = createApp({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
    onCapture: () => {
      fired = true;
    },
  });

  await post(app, "/response", {
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

  t.equal(fired, false, "hook not called when no operation matches");
  t.end();
});

await t.test(
  "createGatewayHandler accepts bindings without active dispatch",
  (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    // Should not throw — bindings can be present even before settlement
    // actually occurs.
    t.doesNotThrow(() =>
      createApp({
        spec: makeSpec(),
        bindings,
        baseURL: BASE_URL,
      }),
    );
    t.end();
  },
);

await t.test("createGatewayHandler rejects missing baseURL", (t) => {
  const bindings = [
    makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
  ];
  t.throws(
    () => createApp({ spec: makeSpec(), bindings, baseURL: "" }),
    /baseURL is required/,
  );
  t.end();
});

// The following tests enforce the contract between the sidecar and the
// OpenResty Lua gateway module. access.lua bails with bad_gateway on any
// non-200 HTTP response from /request, then decodes res.body and reads
// gateway.status to decide what to return to the end client. Any error
// surfaced through a non-200 transport status would be swallowed into an
// opaque 502 Bad Gateway, so the sidecar must always return 200 with an
// error envelope body.

await t.test(
  "/request returns HTTP 200 envelope when validation fails",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const res = await post(app, "/request", { bad: "payload" });
    t.equal(
      res.status,
      200,
      "transport status must be 200 so access.lua can read the envelope",
    );
    const data = (await res.json()) as Record<string, unknown>;
    t.equal(
      data.status,
      400,
      "envelope carries the semantic status for the end client",
    );
    t.end();
  },
);

await t.test(
  "/request returns HTTP 200 envelope when body is malformed JSON",
  async (t) => {
    const bindings = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const req = new Request("http://localhost/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    const res = await app.fetch(req);
    t.equal(
      res.status,
      200,
      "access.lua treats any non-200 as a sidecar failure",
    );
    const data = (await res.json()) as Record<string, unknown>;
    t.equal(data.status, 400, "envelope carries the 400 for the end client");
    t.end();
  },
);

await t.test("/response returns HTTP 500 when validation fails", async (t) => {
  const bindings = [
    makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
  ];
  const { app } = createApp({
    spec: makeSpec(),
    bindings,
    baseURL: BASE_URL,
  });
  const res = await post(app, "/response", { bad: "payload" });
  t.equal(
    res.status,
    500,
    "validation failure on /response must not return 2xx (would cause silent capture loss)",
  );
  t.end();
});

await t.test(
  "/response accepts a request with multi-value headers (e.g. repeated Cookie)",
  async (t) => {
    const bindings = [
      makeBinding([
        { match: "$", authorize: "100", capture: "$.response.body.tokens" },
      ]),
    ];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const res = await post(app, "/response", {
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: { cookie: ["session=abc", "tracking=xyz"] },
      query: {},
      body: { model: "gpt-4o", messages: [] },
      response: {
        status: 200,
        headers: {},
        body: { tokens: 42 },
      },
    });
    t.equal(
      res.status,
      500,
      "stub handler returns null from settle (non-2xx preserves Lua buffer)",
    );
    const envelope = (await res.json()) as Record<string, unknown>;
    t.equal(
      envelope.status,
      500,
      "capture still runs on payloads with multi-value headers",
    );
    t.end();
  },
);

await t.test(
  "/response returns HTTP 422 when capture expression fails",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.usage.nonexistent * 10",
        },
      ]),
    ];
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
    });
    const res = await post(app, "/response", {
      ...requestPayload(),
      response: {
        status: 200,
        headers: {},
        body: { usage: {} },
      },
    });
    t.equal(
      res.status,
      422,
      "capture failures must return 422 so Lua retries without sidecar-down alerts",
    );
    t.end();
  },
);

await t.test(
  "/response exception must not silently discard the capture event",
  async (t) => {
    const bindings = [
      makeBinding([
        {
          match: "$",
          authorize: "100",
          capture: "$.response.body.usage.nonexistent * 10",
        },
      ]),
    ];
    let captureFired = false;
    const { app } = createApp({
      spec: makeSpec(),
      bindings,
      baseURL: BASE_URL,
      onCapture: () => {
        captureFired = true;
      },
    });

    const res = await post(app, "/response", {
      ...requestPayload(),
      response: {
        status: 200,
        headers: {},
        body: { usage: {} },
      },
    });

    const transportIsRetryable = res.status < 200 || res.status >= 300;
    t.ok(
      transportIsRetryable || captureFired,
      "handleResponse failure must either trigger a retry or notify onCapture",
    );
    t.end();
  },
);

// -- Multi-site --

await t.test(
  "createMultiSiteApp routes /sites/<name>/request to the correct handler",
  async (t) => {
    const bindingsA = [
      makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
    ];
    const bindingsB = [
      makeBinding([{ match: "$", authorize: "200", capture: "1" }], {
        "usdc-sol": 10n,
      }),
    ];

    const { app: multiApp } = createMultiSiteApp({
      "site-a": { spec: makeSpec(), bindings: bindingsA, baseURL: BASE_URL },
      "site-b": { spec: makeSpec(), bindings: bindingsB, baseURL: BASE_URL },
    });

    const resA = await post(
      multiApp,
      "/sites/site-a/request",
      requestPayload(),
    );
    const bodyA = (await resA.json()) as { status: number };
    t.equal(resA.status, 200, "site-a must return transport 200");
    t.equal(bodyA.status, 402, "site-a must return 402 challenge");

    const resB = await post(
      multiApp,
      "/sites/site-b/request",
      requestPayload(),
    );
    const bodyB = (await resB.json()) as { status: number };
    t.equal(resB.status, 200, "site-b must return transport 200");
    t.equal(bodyB.status, 402, "site-b must return 402 challenge");

    t.end();
  },
);

await t.test("createMultiSiteApp isolates sites from each other", async (t) => {
  const bindings = [
    makeBinding([{ match: "$", authorize: "100", capture: "1" }]),
  ];

  const { app: multiApp } = createMultiSiteApp({
    "site-a": { spec: makeSpec(), bindings, baseURL: BASE_URL },
  });

  // site-b is not configured — request must fail.
  const res = await post(multiApp, "/sites/site-b/request", requestPayload());
  t.not(res.status, 200, "unconfigured site must not return 200");
  t.end();
});
