#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadSpec } from "./parser.js";
import { generateConfig } from "./index.js";

function usage(): string {
  return `Usage: gateway-nginx --spec <file> --sidecar <url> --upstream <url> --output <dir>

Options:
  --spec       Path to OpenAPI spec file (required)
  --sidecar    Sidecar URL, e.g. http://127.0.0.1:4002 (required)
  --upstream   Upstream URL, e.g. http://127.0.0.1:4000 (required)
  --output     Output directory for generated files (required)
  --help       Show this help message`;
}

function fatal(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      spec: { type: "string" },
      sidecar: { type: "string" },
      upstream: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });

  if (values.help) {
    process.stderr.write(usage() + "\n");
    process.exit(0);
  }

  const missing: string[] = [];
  if (!values.spec) missing.push("--spec");
  if (!values.sidecar) missing.push("--sidecar");
  if (!values.upstream) missing.push("--upstream");
  if (!values.output) missing.push("--output");

  if (missing.length > 0) {
    fatal(`missing required flags: ${missing.join(", ")}\n\n${usage()}`);
  }

  const { spec, sidecar, upstream, output } = values;
  if (!spec || !sidecar || !upstream || !output) {
    fatal("missing required flags");
  }

  const specPath = resolve(spec);
  const outputDir = resolve(output);
  const sidecarURL = sidecar;
  const upstreamURL = upstream;

  const parsed = await loadSpec(specPath);

  const result = generateConfig({
    routes: parsed.routes,
    assets: parsed.assets,
    sidecarURL,
    upstreamURL,
  });

  for (const warning of result.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  await mkdir(join(outputDir, "lua"), { recursive: true });

  await writeFile(join(outputDir, "nginx.conf"), result.nginxConf);

  for (const [filename, content] of result.luaFiles) {
    await writeFile(join(outputDir, "lua", filename), content);
  }

  const specContent = await readFile(specPath);
  await writeFile(join(outputDir, "openapi.yaml"), specContent);

  validateLua(join(outputDir, "lua"));

  process.stderr.write(`generated nginx config in ${outputDir}\n`);
}

function validateLua(luaDir: string) {
  try {
    execFileSync("luajit", ["--version"], { stdio: "ignore" });
  } catch {
    process.stderr.write(
      "warning: luajit not found on PATH, skipping Lua syntax validation\n",
    );
    return;
  }

  try {
    execFileSync("luajit", ["-bl", join(luaDir, "faremeter.lua")], {
      stdio: "pipe",
    });
  } catch (cause) {
    fatal(
      `Lua syntax validation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

main().catch((cause: unknown) => {
  fatal(cause instanceof Error ? cause.message : String(cause));
});
