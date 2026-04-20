#!/usr/bin/env pnpm tsx

import t from "tap";
import { execFile } from "node:child_process";
import { writeFile, mkdtemp, mkdir, rm, cp } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const tmpBase = path.resolve(pkgRoot, "tmp");

async function setup() {
  await mkdir(tmpBase, { recursive: true });
  const tmpDir = await mkdtemp(path.join(tmpBase, "fallback-test-"));
  const fakePkg = path.resolve(tmpDir, "node_modules", "@faremeter", "logs");
  await mkdir(fakePkg, { recursive: true });

  await writeFile(
    path.resolve(tmpDir, "package.json"),
    JSON.stringify({ type: "module" }),
  );

  await cp(path.resolve(pkgRoot, "dist"), path.resolve(fakePkg, "dist"), {
    recursive: true,
  });
  await cp(
    path.resolve(pkgRoot, "package.json"),
    path.resolve(fakePkg, "package.json"),
  );

  // Custom loader hook that blocks @logtape/logtape from resolving, simulating
  // an environment where the optional peer dependency is not installed.
  await writeFile(
    path.resolve(tmpDir, "block-logtape.mjs"),
    `
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(\`
  export async function resolve(specifier, context, next) {
    if (specifier === "@logtape/logtape" || specifier.startsWith("@logtape/")) {
      throw new Error("@logtape/logtape is intentionally blocked for testing");
    }
    return next(specifier, context);
  }
\`), import.meta.url);
`,
  );

  return tmpDir;
}

function run(
  tmpDir: string,
  scriptPath: string,
): Promise<{ stdout: string; stderr: string }> {
  const importPath = path.resolve(tmpDir, "block-logtape.mjs");
  return new Promise<{ stdout: string; stderr: string }>((res, rej) => {
    execFile(
      process.execPath,
      [`--import=${importPath}`, "--no-warnings", scriptPath],
      {
        cwd: tmpDir,
        timeout: 15000,
      },
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          rej(
            new Error(`Script failed:\nstdout: ${stdout}\nstderr: ${stderr}`, {
              cause: error,
            }),
          );
        } else {
          res({ stdout, stderr });
        }
      },
    );
  });
}

await t.test("console fallback when logtape is absent", async (t) => {
  const tmpDir = await setup();
  t.teardown(() => rm(tmpDir, { recursive: true, force: true }));

  const scriptPath = path.resolve(tmpDir, "test-fallback.mjs");

  await writeFile(
    scriptPath,
    `
import { configureApp, getLogger } from "@faremeter/logs";

const results = [];
const original = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

console.debug = (...args) => results.push({ method: "debug", args });
console.info = (...args) => results.push({ method: "info", args });
console.warn = (...args) => results.push({ method: "warn", args });
console.error = (...args) => results.push({ method: "error", args });

await configureApp({ level: "debug" });
const logger = await getLogger(["faremeter", "fallback", "test"]);

logger.debug("debug message");
logger.info("info message", { key: "value" });
logger.warning("warning message");
logger.error("error message");
logger.fatal("fatal message");

console.debug = original.debug;
console.info = original.info;
console.warn = original.warn;
console.error = original.error;

const output = JSON.stringify(results);
process.stdout.write(output);
`,
  );

  const { stdout, stderr } = await run(tmpDir, scriptPath);
  t.equal(stderr, "", "child process should not emit to stderr");

  const results = JSON.parse(stdout) as {
    method: string;
    args: unknown[];
  }[];

  t.equal(results.length, 5, "all five log calls should produce output");

  t.equal(results[0]?.method, "debug", "debug routes to console.debug");
  t.equal(results[0]?.args[0], "debug message", "debug message content");

  t.equal(results[1]?.method, "info", "info routes to console.info");
  t.equal(results[1]?.args[0], "info message", "info message content");
  t.same(results[1]?.args[1], { key: "value" }, "info context passed through");

  t.equal(results[2]?.method, "warn", "warning routes to console.warn");
  t.equal(results[2]?.args[0], "warning message", "warning message content");

  t.equal(results[3]?.method, "error", "error routes to console.error");
  t.equal(results[3]?.args[0], "error message", "error message content");

  t.equal(results[4]?.method, "error", "fatal routes to console.error");
  t.equal(results[4]?.args[0], "fatal message", "fatal message content");

  t.end();
});

await t.test(
  "auto-resolved getLogger falls back to console without configureApp",
  async (t) => {
    const tmpDir = await setup();
    t.teardown(() => rm(tmpDir, { recursive: true, force: true }));

    const scriptPath = path.resolve(tmpDir, "test-auto-resolve.mjs");

    await writeFile(
      scriptPath,
      `
import { getLogger } from "@faremeter/logs";

const results = [];
const original = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

console.debug = (...args) => results.push({ method: "debug", args });
console.info = (...args) => results.push({ method: "info", args });
console.warn = (...args) => results.push({ method: "warn", args });
console.error = (...args) => results.push({ method: "error", args });

const logger = await getLogger(["faremeter", "auto", "test"]);

logger.info("auto-resolved info");
logger.error("auto-resolved error");
logger.debug("auto-resolved debug");

console.debug = original.debug;
console.info = original.info;
console.warn = original.warn;
console.error = original.error;

const output = JSON.stringify(results);
process.stdout.write(output);
`,
    );

    const { stdout, stderr } = await run(tmpDir, scriptPath);
    t.equal(stderr, "", "child process should not emit to stderr");

    const results = JSON.parse(stdout) as {
      method: string;
      args: unknown[];
    }[];

    t.equal(
      results.length,
      2,
      "only info and error should log at default info level",
    );
    t.equal(results[0]?.method, "info", "info method used");
    t.equal(results[0]?.args[0], "auto-resolved info", "info message content");
    t.equal(results[1]?.method, "error", "error method used");
    t.equal(
      results[1]?.args[0],
      "auto-resolved error",
      "error message content",
    );

    t.end();
  },
);

t.teardown(() => rm(tmpBase, { recursive: true, force: true }));
