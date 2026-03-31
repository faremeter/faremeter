#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadGatewaySpec } from "./parser.js";
import { generateConfig } from "./index.js";
import { logger } from "./logger.js";

function usage(): string {
  return `Usage: gateway-nginx --spec <file> --sidecar <url> --upstream <url> --output <dir>

Generates nginx location blocks for inclusion in an operator-managed
nginx.conf via \`include locations.conf;\`. The operator provides
the server block, http wrapper, lua_shared_dict, and lua_package_path.

Options:
  --spec         Path to OpenAPI spec file (required)
  --sidecar      Sidecar URL, e.g. http://127.0.0.1:4002 (required)
  --upstream     Upstream URL used in proxy_pass (required)
  --output       Output directory for generated files (required)
  --site-prefix  Site name for multi-site sidecar routing
  --help         Show this help message`;
}

function fatal(message: string): never {
  logger.error(message);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      spec: { type: "string" },
      sidecar: { type: "string" },
      upstream: { type: "string" },
      output: { type: "string" },
      "site-prefix": { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(usage() + "\n");
    process.exit(0);
  }

  const { spec, sidecar, upstream, output } = values;
  if (!spec) fatal(`missing required flag: --spec\n\n${usage()}`);
  if (!sidecar) fatal(`missing required flag: --sidecar\n\n${usage()}`);
  if (!upstream) fatal(`missing required flag: --upstream\n\n${usage()}`);
  if (!output) fatal(`missing required flag: --output\n\n${usage()}`);

  const specPath = resolve(spec);
  const outputDir = resolve(output);

  const parsed = await loadGatewaySpec(specPath);

  const result = generateConfig({
    routes: parsed.routes,
    sidecarURL: sidecar,
    upstreamURL: upstream,
    specRoot: outputDir,
    sitePrefix: values["site-prefix"],
  });

  for (const warning of result.warnings) {
    logger.warning(warning);
  }

  await mkdir(join(outputDir, "lua"), { recursive: true });

  await writeFile(join(outputDir, "locations.conf"), result.locationsConf);

  const luaFileNames: string[] = [];
  for (const [filename, content] of result.luaFiles) {
    await writeFile(join(outputDir, "lua", filename), content);
    luaFileNames.push(filename);
  }

  const specContent = await readFile(specPath);
  await writeFile(join(outputDir, "openapi.yaml"), specContent);

  await validateLua(join(outputDir, "lua"), luaFileNames);

  logger.info(`generated nginx locations in ${outputDir}`);
}

async function validateLua(luaDir: string, luaFileNames: string[]) {
  try {
    execFileSync("luajit", ["--version"], { stdio: "ignore" });
  } catch {
    logger.warning("luajit not found on PATH, skipping Lua syntax validation");
    return;
  }

  for (const name of luaFileNames) {
    try {
      execFileSync("luajit", ["-bl", join(luaDir, name)], { stdio: "pipe" });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      fatal(`Lua syntax validation failed for ${name}: ${reason}`);
    }
  }
}

main().catch((cause: unknown) => {
  fatal(cause instanceof Error ? cause.message : String(cause));
});
