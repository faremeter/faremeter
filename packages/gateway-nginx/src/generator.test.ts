#!/usr/bin/env pnpm tsx

import t from "tap";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { GeneratorInput } from "./types.js";
import { generateConfig } from "./index.js";
import { loadGatewaySpec } from "./parser.js";

const fixturesDir = resolve(
  dirname(new URL(import.meta.url).pathname),
  "fixtures",
);
const expectedDir = resolve(fixturesDir, "expected");

async function loadTestInput(): Promise<GeneratorInput> {
  const spec = await loadGatewaySpec(resolve(fixturesDir, "openapi.yaml"));
  return {
    routes: spec.routes,
    sidecarURL: "http://127.0.0.1:4002",
    upstreamURL: "http://127.0.0.1:4000",
    specRoot: "/etc/nginx",
  };
}

await t.test("generateConfig produces expected locations.conf", async (t) => {
  const input = await loadTestInput();
  const result = generateConfig(input);

  const expected = readFileSync(
    resolve(expectedDir, "locations.conf"),
    "utf-8",
  );
  t.equal(result.locationsConf, expected, "locations.conf matches golden file");
  t.end();
});

await t.test("generateConfig produces expected faremeter.lua", async (t) => {
  const input = await loadTestInput();
  const result = generateConfig(input);

  const expectedLua = readFileSync(
    resolve(expectedDir, "faremeter.lua"),
    "utf-8",
  );
  const actualLua = result.luaFiles.get("faremeter.lua");
  t.equal(actualLua, expectedLua, "faremeter.lua matches golden file");
  t.end();
});

await t.test("generateConfig output is deterministic", async (t) => {
  const input = await loadTestInput();

  const result1 = generateConfig(input);
  const result2 = generateConfig(input);

  t.equal(
    result1.locationsConf,
    result2.locationsConf,
    "locations.conf is deterministic",
  );
  t.equal(
    result1.luaFiles.get("faremeter.lua"),
    result2.luaFiles.get("faremeter.lua"),
    "faremeter.lua is deterministic",
  );
  t.end();
});

await t.test("generated locations contain expected routes", async (t) => {
  const input = await loadTestInput();
  const result = generateConfig(input);

  t.match(result.locationsConf, /location = \/v1\/chat\/completions/);
  t.match(result.locationsConf, /location = \/v1\/chat\/stream/);
  t.match(result.locationsConf, /location = \/v1\/images\/generations/);
  t.match(result.locationsConf, /location = \/v1\/data/);
  t.match(
    result.locationsConf,
    /location ~ \^\/v1\/\(\[\^\/\]\+\)\/completions\$/,
  );
  t.match(result.locationsConf, /\.well-known\/openapi\.yaml/);
  t.end();
});
