#!/usr/bin/env pnpm tsx

import t from "tap";
import type { RouteConfig } from "../types.js";
import { generateLocationBlocks } from "./location.js";

const defaultOpts = {
  sidecarURL: "http://127.0.0.1:4002",
  upstreamURL: "http://127.0.0.1:4000",
};

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    path: "/v1/test",
    method: "POST",
    pricingRules: { base: "100" },
    transportType: "json",
    pricingMode: "one-phase",
    captureFields: [],
    ...overrides,
  };
}

await t.test("HTTP-only path produces a single location block", async (t) => {
  const routes = [
    makeRoute({ path: "/v1/chat", method: "POST" }),
    makeRoute({ path: "/v1/chat", method: "GET" }),
  ];

  const result = generateLocationBlocks(routes, defaultOpts);

  const locationMatches = result.block.match(/^location /gm);
  t.equal(locationMatches?.length, 1);
  t.equal(result.warnings.length, 0);
  t.end();
});

await t.test(
  "WebSocket-only path produces a location block per route",
  async (t) => {
    const routes = [
      makeRoute({
        path: "/v1/ws",
        method: "GET",
        transportType: "websocket",
      }),
    ];

    const result = generateLocationBlocks(routes, defaultOpts);

    const locationMatches = result.block.match(/^location /gm);
    t.equal(locationMatches?.length, 1);
    t.equal(result.warnings.length, 0);
    t.end();
  },
);

await t.test(
  "Mixed HTTP and WebSocket path produces a single combined block with a warning",
  async (t) => {
    const routes = [
      makeRoute({ path: "/v1/stream", method: "POST", transportType: "json" }),
      makeRoute({
        path: "/v1/stream",
        method: "GET",
        transportType: "websocket",
      }),
    ];

    const result = generateLocationBlocks(routes, defaultOpts);

    const locationMatches = result.block.match(/^location /gm);
    // A WS-upgrade path emits a named WS location and an HTTP
    // location that jumps to it via `error_page`.
    t.equal(
      locationMatches?.length,
      2,
      "should produce two location blocks (WS named + HTTP)",
    );

    t.ok(
      result.warnings.some((w) => w.includes("both HTTP and WebSocket")),
      "should emit a warning about mixed transport types",
    );
    t.end();
  },
);

await t.test(
  "Combined HTTP/WebSocket block contains upgrade detection",
  async (t) => {
    const routes = [
      makeRoute({ path: "/v1/stream", method: "POST", transportType: "json" }),
      makeRoute({
        path: "/v1/stream",
        method: "GET",
        transportType: "websocket",
      }),
    ];

    const result = generateLocationBlocks(routes, defaultOpts);

    t.match(
      result.block,
      /http_upgrade/,
      "combined block should reference http_upgrade for WebSocket detection",
    );
    t.end();
  },
);

await t.test(
  "Combined HTTP/WebSocket block uses a valid internal-jump directive",
  async (t) => {
    // nginx's `rewrite` directive takes a URI replacement, not a named
    // location. Named locations (@foo) are reachable only through
    // `error_page`, `try_files`, or a similar internal-redirect directive.
    // Emitting `rewrite ^ @name last;` is a parse error at nginx load time
    // and will make the whole mixed-transport path unusable.
    const routes = [
      makeRoute({ path: "/v1/stream", method: "POST", transportType: "json" }),
      makeRoute({
        path: "/v1/stream",
        method: "GET",
        transportType: "websocket",
      }),
    ];

    const result = generateLocationBlocks(routes, defaultOpts);

    t.notMatch(
      result.block,
      /rewrite\s+\^\s+@/,
      "rewrite does not accept a named location as its replacement",
    );
    t.end();
  },
);

await t.test(
  "proxy_buffering is emitted as a literal, not a variable",
  async (t) => {
    // nginx's proxy_buffering directive is documented as taking a literal
    // `on | off` — it does not officially accept a runtime variable, and
    // `header_filter_by_lua_block` runs after nginx has already decided
    // how to buffer the upstream response. Relying on
    // `proxy_buffering $var;` combined with `ngx.var.proxy_buffering = ...`
    // gives the illusion of streaming support without actually disabling
    // buffering for the current request.
    const routes = [
      makeRoute({
        path: "/v1/stream",
        method: "POST",
        transportType: "sse",
      }),
    ];

    const result = generateLocationBlocks(routes, defaultOpts);

    t.notMatch(
      result.block,
      /proxy_buffering\s+\$/,
      "proxy_buffering must take a literal on|off value",
    );
    t.end();
  },
);

await t.test(
  "multiple WebSocket operations on the same path must not produce duplicate locations",
  async (t) => {
    // nginx rejects `[emerg] duplicate location` at config load time.
    // The mixed HTTP + multi-WS branch warns and drops extras; the
    // pure-WS branch must do the same — or reject the input loudly.
    // Silent duplication produces a config that nginx refuses to load.
    const routes = [
      makeRoute({
        path: "/v1/ws",
        method: "GET",
        transportType: "websocket",
      }),
      makeRoute({
        path: "/v1/ws",
        method: "POST",
        transportType: "websocket",
      }),
    ];

    const result = generateLocationBlocks(routes, defaultOpts);

    const duplicates = result.block.match(/location = \/v1\/ws /g) ?? [];
    t.ok(
      duplicates.length <= 1,
      `expected at most one \`location = /v1/ws\` block, got ${duplicates.length}`,
    );
    t.end();
  },
);

await t.test(
  "generateLocationBlocks rejects specRoot with nginx-breaking characters",
  async (t) => {
    // specRoot is interpolated into `root <value>;`. A double
    // quote, newline, or semicolon in the value can break out of
    // the directive and inject arbitrary nginx config. Parity
    // with the existing luaPackagePath validation.
    for (const bad of [
      '/tmp; return 200 "hacked"',
      "/tmp\nevil_directive on",
      '/tmp"; evil',
    ]) {
      t.throws(
        () =>
          generateLocationBlocks([], {
            ...defaultOpts,
            specRoot: bad,
          }),
        /invalid|unsafe/i,
        `specRoot ${JSON.stringify(bad)} must throw`,
      );
    }
    t.end();
  },
);

await t.test(
  "spec endpoint emits only when specRoot is configured",
  async (t) => {
    const withoutRoot = generateLocationBlocks([], defaultOpts);
    t.notMatch(
      withoutRoot.block,
      /\.well-known\/openapi\.yaml/,
      "no spec endpoint when specRoot is not set",
    );

    const withRoot = generateLocationBlocks([], {
      ...defaultOpts,
      specRoot: "/tmp/my-output",
    });
    t.match(
      withRoot.block,
      /location\s*=\s*\/\.well-known\/openapi\.yaml/,
      "spec endpoint present when specRoot is set",
    );
    t.match(
      withRoot.block,
      /root\s+\/tmp\/my-output\s*;/,
      "spec endpoint root must honor the configured specRoot",
    );
    t.notMatch(
      withRoot.block,
      /root\s+\/etc\/nginx\s*;/,
      "spec endpoint root must not hardcode /etc/nginx",
    );
    t.end();
  },
);

await t.test(
  "extraDirectives are emitted in HTTP location blocks",
  async (t) => {
    const routes = [makeRoute({ path: "/v1/chat", method: "POST" })];
    const result = generateLocationBlocks(routes, {
      ...defaultOpts,
      extraDirectives: [
        "proxy_read_timeout 3600s;",
        "proxy_send_timeout 3600s;",
      ],
    });

    t.match(
      result.block,
      /proxy_read_timeout 3600s;/,
      "first extra directive is present",
    );
    t.match(
      result.block,
      /proxy_send_timeout 3600s;/,
      "second extra directive is present",
    );
    t.end();
  },
);

await t.test(
  "extraDirectives are emitted in WebSocket location blocks",
  async (t) => {
    const routes = [
      makeRoute({
        path: "/v1/ws",
        method: "GET",
        transportType: "websocket",
      }),
    ];
    const result = generateLocationBlocks(routes, {
      ...defaultOpts,
      extraDirectives: ["proxy_read_timeout 3600s;"],
    });

    t.match(
      result.block,
      /proxy_read_timeout 3600s;/,
      "extra directive is present in WebSocket location",
    );
    t.end();
  },
);

await t.test("extraDirectives appear before Lua blocks", async (t) => {
  const routes = [makeRoute({ path: "/v1/chat", method: "POST" })];
  const result = generateLocationBlocks(routes, {
    ...defaultOpts,
    extraDirectives: ["proxy_read_timeout 3600s;"],
  });

  const directiveIdx = result.block.indexOf("proxy_read_timeout 3600s;");
  const luaIdx = result.block.indexOf("access_by_lua_block");
  t.ok(
    directiveIdx < luaIdx,
    "extra directive appears before access_by_lua_block",
  );
  t.end();
});

await t.test(
  "extraDirectives appear before WebSocket upgrade directives in mixed locations",
  async (t) => {
    const routes = [
      makeRoute({ path: "/v1/stream", method: "POST", transportType: "json" }),
      makeRoute({
        path: "/v1/stream",
        method: "GET",
        transportType: "websocket",
      }),
    ];
    const result = generateLocationBlocks(routes, {
      ...defaultOpts,
      extraDirectives: ["proxy_read_timeout 3600s;"],
    });

    const httpBlock = result.block.slice(
      result.block.indexOf("location = /v1/stream"),
    );
    const directiveIdx = httpBlock.indexOf("proxy_read_timeout 3600s;");
    const upgradeIdx = httpBlock.indexOf("error_page 418");
    t.ok(
      directiveIdx < upgradeIdx,
      "extra directive appears before upgrade detection",
    );
    t.end();
  },
);

await t.test(
  "extraDirectives are emitted in the named WS location of mixed paths",
  async (t) => {
    const routes = [
      makeRoute({ path: "/v1/stream", method: "POST", transportType: "json" }),
      makeRoute({
        path: "/v1/stream",
        method: "GET",
        transportType: "websocket",
      }),
    ];
    const result = generateLocationBlocks(routes, {
      ...defaultOpts,
      extraDirectives: ["proxy_read_timeout 3600s;"],
    });

    const wsBlock = result.block.slice(
      result.block.indexOf("location @ws_"),
      result.block.indexOf("location = /v1/stream"),
    );
    t.match(
      wsBlock,
      /proxy_read_timeout 3600s;/,
      "extra directive is present in named WS location",
    );
    t.end();
  },
);

await t.test(
  "extraDirectives with embedded newlines are split and indented",
  async (t) => {
    const routes = [makeRoute({ path: "/v1/chat", method: "POST" })];
    const result = generateLocationBlocks(routes, {
      ...defaultOpts,
      extraDirectives: ["proxy_read_timeout 3600s;\nproxy_send_timeout 3600s;"],
    });

    t.match(
      result.block,
      /^ {2}proxy_read_timeout 3600s;$/m,
      "first line is indented",
    );
    t.match(
      result.block,
      /^ {2}proxy_send_timeout 3600s;$/m,
      "second line after newline split is indented",
    );
    t.end();
  },
);
