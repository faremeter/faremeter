#!/usr/bin/env pnpm tsx

import t from "tap";
import type { FaremeterSpec } from "@faremeter/middleware-openapi";
import { createApp, createMultiSiteApp } from "./app.js";

const OP = "POST /v1/chat/completions";

function makeSpec(
  rules: NonNullable<FaremeterSpec["operations"][string]["rules"]>,
  rates: Record<string, bigint> = { "usdc-sol": 1n },
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
      [OP]: {
        method: "POST",
        path: "/v1/chat/completions",
        transport: "json",
        rates,
        rules,
      },
    },
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
  const spec = makeSpec([
    {
      match: "$",
      authorize: "5000",
      capture: "$.response.body.usage.prompt_tokens * 10",
    },
  ]);
  const { app } = createApp({ spec, baseURL: BASE_URL });

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
  const { app } = createApp({ spec, baseURL: BASE_URL });

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
    // A null body silently coerced to `{}` would let a spec edit
    // add a `$.request.body.*` match filter and bypass billing on
    // empty-body requests. The handler rejects null; the sidecar
    // surfaces the handler exception as the route's error envelope.
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const { app } = createApp({ spec, baseURL: BASE_URL });

    const res = await post(app, "/request", {
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
      query: {},
      body: null,
    });
    const data = (await res.json()) as Record<string, unknown>;

    // Transport stays 200 for the /request contract; the envelope
    // carries the 500 for the end client.
    t.equal(res.status, 200);
    t.equal(data.status, 500);
    t.end();
  },
);

await t.test("response evaluates capture and returns amount", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "5000",
      capture:
        "$.response.body.usage.prompt_tokens * 10 + $.response.body.usage.completion_tokens * 30",
    },
  ]);
  const { app } = createApp({ spec, baseURL: BASE_URL });

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
  const { app } = createApp({ spec, baseURL: BASE_URL });

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

await t.test(
  "onCapture throw does not corrupt the settled response",
  async (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    let hookFired = false;
    const { app } = createApp({
      spec,
      baseURL: BASE_URL,
      onCapture: () => {
        hookFired = true;
        throw new Error("hook blew up");
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
    t.equal(res.status, 200, "settled response preserved despite hook throw");
    const data = (await res.json()) as Record<string, unknown>;
    t.equal(data.captured, true);
    t.ok(hookFired, "hook was invoked");
    t.end();
  },
);

await t.test("onCapture fires on successful settlement", async (t) => {
  const spec = makeSpec([
    {
      match: "$",
      authorize: "100",
      capture: "$.response.body.usage.total_tokens * 2",
    },
  ]);
  const calls: { key: string; amount: unknown }[] = [];
  const { app } = createApp({
    spec,
    baseURL: BASE_URL,
    onCapture: (operationKey, result) => {
      calls.push({ key: operationKey, amount: result.amount });
    },
  });

  await post(app, "/response", {
    ...requestPayload(),
    response: {
      status: 200,
      headers: {},
      body: { usage: { total_tokens: 50 } },
    },
  });

  t.equal(calls.length, 1);
  t.equal(calls[0]?.key, OP);
  t.match(calls[0]?.amount, { "usdc-sol": "100" });
  t.end();
});

await t.test("onCapture does not fire on validation error", async (t) => {
  const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
  let fired = false;
  const { app } = createApp({
    spec,
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

await t.test(
  "createGatewayHandler warns when rules exist but no handlers",
  (t) => {
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    // Should not throw — sidecar can still advertise 402 pricing without
    // payment handlers, which is the legitimate use case in this test.
    t.doesNotThrow(() => createApp({ spec, baseURL: BASE_URL }));
    t.end();
  },
);

await t.test("createGatewayHandler rejects missing baseURL", (t) => {
  const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
  t.throws(() => createApp({ spec, baseURL: "" }), /baseURL is required/);
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
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const { app } = createApp({ spec, baseURL: BASE_URL });
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
    const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const { app } = createApp({ spec, baseURL: BASE_URL });
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
  // `flush_capture` in `packages/gateway-nginx/src/lua/shared.lua`
  // deletes the capture buffer on any 2xx response. Returning 200
  // + envelope on a validation failure would silently destroy the
  // buffered capture and lose the bill. Non-2xx forces Lua to
  // schedule retries (which will fail the same way on a permanent
  // validation error, but retry exhaustion is preferable to silent
  // data loss, and the log noise surfaces the misconfiguration).
  const spec = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
  const { app } = createApp({ spec, baseURL: BASE_URL });
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
    // `packages/gateway-nginx/src/lua/access.lua` uses
    // `array_aware()` to preserve multi-value headers as arrays
    // rather than lossy comma joins (RFC 7230 §3.2.2). The payload
    // that reaches the sidecar therefore carries headers in the
    // `Record<string, string | string[]>` shape whenever the client
    // repeats a header name. Every logged-in user's request carries
    // at least one `Cookie` header, so if the schema only accepts
    // `Record<string, string>` the validation fails and (prior to
    // the 500-on-validation-failure fix above) silently deletes the
    // capture buffer. Pin the accepted shape here.
    const spec = makeSpec([
      { match: "$", authorize: "100", capture: "$.response.body.tokens" },
    ]);
    const { app } = createApp({ spec, baseURL: BASE_URL });
    const res = await post(app, "/response", {
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      // Two cookies arrive as an array — the realistic production
      // shape for any request carrying more than one Cookie header.
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
      200,
      "multi-value headers must not be rejected by the schema",
    );
    const envelope = (await res.json()) as Record<string, unknown>;
    t.equal(
      envelope.captured,
      true,
      "capture still runs on payloads with multi-value headers",
    );
    t.end();
  },
);

await t.test(
  "/response returns HTTP 422 when capture expression fails",
  async (t) => {
    // A dynamic capture failure (missing field, negative
    // coefficient) propagates out of handleResponse. The sidecar
    // returns 422 (not 500) so Lua retries without triggering
    // sidecar-down alerts. 422 signals the capture expression
    // could not evaluate against the response body — the sidecar
    // itself is healthy.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.nonexistent * 10",
      },
    ]);
    const { app } = createApp({ spec, baseURL: BASE_URL });
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
  "async onCapture that rejects does not leak an unhandled rejection",
  async (t) => {
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.total_tokens",
      },
    ]);
    const rejections: unknown[] = [];
    const listener = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", listener);
    try {
      const { app } = createApp({
        spec,
        baseURL: BASE_URL,
        // onCapture is typed `=> void` but TypeScript will accept a
        // Promise<void> returning function. A rejected promise must not
        // become an unhandled rejection because the sidecar's try/catch
        // only catches synchronous throws.
        onCapture: (() => {
          return Promise.reject(new Error("async hook rejection"));
        }) as (key: string, result: unknown) => void,
      });
      const res = await post(app, "/response", {
        ...requestPayload(),
        response: {
          status: 200,
          headers: {},
          body: { usage: { total_tokens: 50 } },
        },
      });
      t.equal(res.status, 200, "settled response preserved despite async hook");
      // Give the event loop time for any unhandled rejection to fire.
      await new Promise((resolve) => setTimeout(resolve, 10));
      t.equal(
        rejections.length,
        0,
        "async onCapture must not leak unhandled rejections",
      );
    } finally {
      process.off("unhandledRejection", listener);
    }
    t.end();
  },
);

await t.test(
  "/response exception must not silently discard the capture event",
  async (t) => {
    // handleResponse throws when the capture expression resolves to
    // nothing. The current code catches, logs, and returns an HTTP 200
    // envelope with an inner `status: 500`. But `flush_capture` in
    // packages/gateway-nginx/src/lua/shared.lua inspects only the HTTP
    // transport status and treats 2xx as success — it then runs
    // `dict:delete(key)` with no retry. Because the catch path returns
    // before the onCapture block, the hook never fires either. That
    // combination silently drops the capture forever.
    //
    // Either the transport status must be retryable (non-2xx so Lua
    // schedules a retry), or onCapture must be invoked with enough
    // information for downstream to record the failure. Both are
    // acceptable; silent loss is not.
    const spec = makeSpec([
      {
        match: "$",
        authorize: "100",
        capture: "$.response.body.usage.nonexistent * 10",
      },
    ]);
    let captureFired = false;
    const { app } = createApp({
      spec,
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
    const siteA = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);
    const siteB = makeSpec([{ match: "$", authorize: "200", capture: "1" }], {
      "usdc-sol": 10n,
    });

    const { app: multiApp } = createMultiSiteApp({
      "site-a": { spec: siteA, baseURL: BASE_URL },
      "site-b": { spec: siteB, baseURL: BASE_URL },
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
  const siteA = makeSpec([{ match: "$", authorize: "100", capture: "1" }]);

  const { app: multiApp } = createMultiSiteApp({
    "site-a": { spec: siteA, baseURL: BASE_URL },
  });

  // site-b is not configured — request must fail.
  const res = await post(multiApp, "/sites/site-b/request", requestPayload());
  t.not(res.status, 200, "unconfigured site must not return 200");
  t.end();
});
