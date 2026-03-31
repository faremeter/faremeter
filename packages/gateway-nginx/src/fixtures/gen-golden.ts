#!/usr/bin/env pnpm tsx

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { generateConfig } from "../index.js";
import { loadSpec } from "../parser.js";

const fixturesDir = dirname(new URL(import.meta.url).pathname);
const expectedDir = resolve(fixturesDir, "expected");
mkdirSync(expectedDir, { recursive: true });

const spec = await loadSpec(resolve(fixturesDir, "openapi.yaml"));

const result = generateConfig({
  routes: spec.routes,
  assets: spec.assets,
  sidecarURL: "http://127.0.0.1:4002",
  upstreamURL: "127.0.0.1:4000",
});

writeFileSync(resolve(expectedDir, "nginx.conf"), result.nginxConf);

for (const [name, content] of result.luaFiles) {
  writeFileSync(resolve(expectedDir, name), content);
}

if (result.warnings.length > 0) {
  writeFileSync(
    resolve(expectedDir, "warnings.txt"),
    result.warnings.join("\n") + "\n",
  );
}

// eslint-disable-next-line no-console
console.log("Golden files generated:", {
  nginxConf: `${result.nginxConf.length} bytes`,
  luaFiles: [...result.luaFiles.keys()],
  warnings: result.warnings,
});
