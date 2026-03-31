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
  // One for the spec endpoint, one for the HTTP path
  t.equal(locationMatches?.length, 2);
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
    // One for the spec endpoint, one for the WS route
    t.equal(locationMatches?.length, 2);
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
    // One for spec endpoint, one named WS location, one HTTP location
    t.equal(
      locationMatches?.length,
      3,
      "should produce three location blocks (spec + WS named + HTTP)",
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
