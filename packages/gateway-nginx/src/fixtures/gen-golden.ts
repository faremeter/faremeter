#!/usr/bin/env pnpm tsx

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { generateConfig } from "../index.js";
import { loadGatewaySpec } from "../parser.js";

const fixturesDir = dirname(new URL(import.meta.url).pathname);
const expectedDir = resolve(fixturesDir, "expected");
mkdirSync(expectedDir, { recursive: true });

const spec = await loadGatewaySpec(resolve(fixturesDir, "openapi.yaml"));

const result = generateConfig({
  routes: spec.routes,
  sidecarURL: "http://127.0.0.1:4002",
  upstreamURL: "http://127.0.0.1:4000",
  specRoot: "/etc/nginx",
});

writeFileSync(resolve(expectedDir, "locations.conf"), result.locationsConf);

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
  nginxConf: `${result.locationsConf.length} bytes`,
  luaFiles: [...result.luaFiles.keys()],
  warnings: result.warnings,
});
