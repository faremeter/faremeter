#!/usr/bin/env pnpm tsx

import t from "tap";
import { $ } from "zx/core";
import { sleep } from "zx";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const luaDir = dirname(fileURLToPath(import.meta.url));
const tmpDir = resolve(luaDir, "tmp");
const pidFile = resolve(tmpDir, "nginx.pid");
const confFile = resolve(tmpDir, "test.conf");

/**
 * Resolve the OpenResty binary in priority order:
 *   1. `FAREMETER_OPENRESTY_BIN` env var — explicit override, must exist.
 *   2. Anything named `openresty` on `$PATH` (macOS + Linux).
 *   3. A small allow-list of common install locations (Homebrew, Linux).
 * Returns null if none of the above work — the caller decides whether
 * to skip or fail.
 */
function resolveOpenResty(): string | null {
  const override = process.env.FAREMETER_OPENRESTY_BIN;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`FAREMETER_OPENRESTY_BIN="${override}" does not exist`);
    }
    return override;
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, "openresty");
    if (existsSync(candidate)) return candidate;
  }

  const fallbacks = [
    "/opt/homebrew/bin/openresty", // macOS Apple Silicon
    "/usr/local/bin/openresty", // macOS Intel / Linux manual
    "/usr/local/openresty/bin/openresty", // Linux package default
    "/usr/bin/openresty", // Linux distro package
  ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

const OPENRESTY_BIN = resolveOpenResty();

$.verbose = false;

if (!OPENRESTY_BIN) {
  t.pass(
    "openresty not found on PATH, common install paths, or via " +
      "FAREMETER_OPENRESTY_BIN — skipping shared dict tests",
  );
  process.exit(0);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to get address"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

const port = await getFreePort();
const base = `http://127.0.0.1:${port}`;

await mkdir(tmpDir, { recursive: true });

await writeFile(
  confFile,
  `worker_processes 1;
pid ${pidFile};
error_log ${resolve(tmpDir, "error.log")} warn;

events {
  worker_connections 16;
}

http {
  lua_shared_dict fm_capture_buffer 1m;
  lua_package_path "${luaDir}/?.lua;${resolve(luaDir, "../fixtures/expected")}/?.lua;;";

  server {
    listen 127.0.0.1:${port};

    location / {
      default_type application/json;
      content_by_lua_file ${resolve(luaDir, "shared.test.lua")};
    }
  }
}
`,
);

await $`${OPENRESTY_BIN} -p ${tmpDir} -c ${confFile}`;
await sleep(300);

t.teardown(async () => {
  if (existsSync(pidFile)) {
    const pid = readFileSync(pidFile, "utf-8").trim();
    process.kill(Number(pid), "SIGQUIT");
  }
  await sleep(200);
  await rm(tmpDir, { recursive: true, force: true });
});

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}${path}`);
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`expected JSON object from ${path}, got ${typeof body}`);
  }
  return body as Record<string, unknown>;
}

await t.test("write and read back from shared dict", async (t) => {
  const res = await get("/write-and-read");
  t.equal(res.stored, '{"tokens":42}');
  t.end();
});

await t.test(
  "concurrent keys with different request IDs do not collide",
  async (t) => {
    const res = await get("/concurrent-keys");
    t.equal(res.a, '{"request":"first"}');
    t.equal(res.b, '{"request":"second"}');
    t.end();
  },
);

await t.test("same composite key overwrites previous value", async (t) => {
  const res = await get("/overwrite");
  t.equal(res.stored, '{"attempt":2}');
  t.end();
});

await t.test("flush with premature flag leaves dict untouched", async (t) => {
  const res = await get("/flush-premature");
  t.equal(res.stored, '{"data":"keep"}');
  t.end();
});

await t.test("flush with missing key is a safe no-op", async (t) => {
  const res = await get("/flush-missing");
  t.equal(res.stored, null);
  t.end();
});

await t.test("extract_field navigates dot-notation paths", async (t) => {
  const res = await get("/extract-dot-path");
  t.equal(res.prompt, 12);
  t.equal(res.completion, 34);
  t.equal(res.missing, null);
  t.end();
});

await t.test(
  "extract_field handles ['quoted.key'] bracket notation",
  async (t) => {
    const res = await get("/extract-bracket-path");
    t.equal(res.value, 42);
    t.end();
  },
);

await t.test("extract_field handles numeric [index] notation", async (t) => {
  const res = await get("/extract-numeric-index");
  t.equal(res.first, "alpha");
  t.equal(res.third, "gamma");
  t.end();
});

await t.test(
  "extract_field rejects non-numeric unquoted bracket",
  async (t) => {
    const res = await get("/extract-unparseable");
    t.equal(res.result, null);
    t.end();
  },
);

await t.test(
  "reconstruct_nested rebuilds nested object from flat paths",
  async (t) => {
    const res = await get("/reconstruct-nested");
    t.match(res, {
      usage: { prompt_tokens: 12, completion_tokens: 34 },
      model: "gpt-4o",
    });
    t.end();
  },
);

await t.test("parse_sse_chunk buffers across chunk boundaries", async (t) => {
  const res = await get("/parse-sse-split");
  // cjson encodes an empty Lua table as `{}`, not `[]`, so assert emptiness
  // by key count rather than an ambiguous array pattern match.
  const first = res.first_batch;
  t.equal(
    typeof first === "object" && first !== null
      ? Object.keys(first).length
      : -1,
    0,
    "first chunk produces no events (partial line buffered)",
  );
  t.match(res.second_batch, ["hello world", "next"]);
  t.end();
});

await t.test("parse_sse_chunk skips comment lines", async (t) => {
  const res = await get("/parse-sse-comments");
  t.match(res.events, ["payload", "second"]);
  t.end();
});

await t.test("parse_sse_chunk handles CRLF line endings", async (t) => {
  const res = await get("/parse-sse-crlf");
  t.match(res.events, ["first", "second"]);
  t.end();
});

await t.test(
  "accumulate_fields merges across frames for ws multi-frame capture",
  async (t) => {
    const res = await get("/ws-multi-frame-accumulate");
    t.equal(
      res.prompt_tokens,
      10,
      "frame-1 prompt_tokens must survive frame-2 extraction",
    );
    t.equal(
      res.completion_tokens,
      20,
      "frame-2 completion_tokens must be added to the accumulated body",
    );
    t.end();
  },
);

await t.test(
  "is_sse_content_type handles string and table Content-Type values",
  async (t) => {
    const res = await get("/is-sse-content-type");
    t.equal(res.plain, true, "canonical text/event-stream");
    t.equal(res.uppercase, true, "uppercase TEXT/EVENT-STREAM");
    t.equal(res.mixed, true, "mixed case with charset parameter");
    t.equal(res.empty, false, "empty string is not SSE");
    t.equal(res.nil_val, false, "nil is not SSE");
    t.equal(res.html, false, "text/html is not SSE");
    t.equal(
      res.table_with_sse,
      true,
      "multi-valued header containing text/event-stream must be detected as SSE",
    );
    t.equal(
      res.table_without_sse,
      false,
      "multi-valued header without SSE is not SSE",
    );
    t.equal(res.table_empty, false, "empty table is not SSE");
    t.end();
  },
);

await t.test(
  "parse_sse_chunk caps data_lines accumulator without event terminator",
  async (t) => {
    // Defends against a hostile or buggy upstream that emits many
    // `data:` lines without ever sending the blank-line event
    // terminator. Without a cap on the data_lines accumulator, each
    // per-chunk `#raw` snapshot stays under the 1 MiB limit while
    // the accumulated value bytes grow without bound — memory
    // pressure scales linearly with how long the attacker keeps
    // pushing data. The endpoint feeds ~1.1 MB of value bytes in
    // chunks of ~103 KB each and expects overflow to trip.
    const res = await get("/parse-sse-data-lines-overflow");
    t.equal(
      res.overflow,
      true,
      "data_lines accumulator cap must trip for unterminated data-line stream",
    );
    t.equal(
      res.data_lines_count,
      0,
      "on overflow the data_lines table is cleared",
    );
    t.end();
  },
);
