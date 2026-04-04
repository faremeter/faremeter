#!/usr/bin/env pnpm tsx

import t from "tap";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { GeneratorInput } from "./types.js";
import { generateConfig } from "./index.js";
import { loadSpec } from "./parser.js";

const fixturesDir = resolve(
  dirname(new URL(import.meta.url).pathname),
  "fixtures",
);
const expectedDir = resolve(fixturesDir, "expected");

async function loadTestInput(): Promise<GeneratorInput> {
  const spec = await loadSpec(resolve(fixturesDir, "openapi.yaml"));
  return {
    routes: spec.routes,
    assets: spec.assets,
    sidecarURL: "http://127.0.0.1:4002",
    upstreamURL: "127.0.0.1:4000",
  };
}

await t.test("generateConfig produces expected nginx.conf", async (t) => {
  const input = await loadTestInput();
  const result = generateConfig(input);

  const expectedNginx = readFileSync(
    resolve(expectedDir, "nginx.conf"),
    "utf-8",
  );
  t.equal(result.nginxConf, expectedNginx, "nginx.conf matches golden file");
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

  t.equal(result1.nginxConf, result2.nginxConf, "nginx.conf is deterministic");
  t.equal(
    result1.luaFiles.get("faremeter.lua"),
    result2.luaFiles.get("faremeter.lua"),
    "faremeter.lua is deterministic",
  );
  t.end();
});

await t.test("generated nginx.conf contains expected routes", async (t) => {
  const input = await loadTestInput();
  const result = generateConfig(input);

  t.match(result.nginxConf, /location = \/v1\/chat\/completions/);
  t.match(result.nginxConf, /location = \/v1\/chat\/stream/);
  t.match(result.nginxConf, /location = \/v1\/images\/generations/);
  t.match(result.nginxConf, /location = \/v1\/data/);
  t.match(result.nginxConf, /location ~ \^\/v1\/\(\[\^\/\]\+\)\/completions\$/);
  t.match(result.nginxConf, /\.well-known\/openapi\.yaml/);
  t.end();
});
