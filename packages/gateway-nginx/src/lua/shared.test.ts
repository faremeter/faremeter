#!/usr/bin/env pnpm tsx

import t from "tap";
import { $ } from "zx/core";
import { sleep } from "zx";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const luaDir = dirname(fileURLToPath(import.meta.url));
const tmpDir = resolve(luaDir, "tmp");
const pidFile = resolve(tmpDir, "nginx.pid");
const confFile = resolve(tmpDir, "test.conf");
const OPENRESTY_BIN = "/opt/homebrew/bin/openresty";

$.verbose = false;

if (!existsSync(OPENRESTY_BIN)) {
  t.pass("openresty not found, skipping shared dict tests");
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  return (await res.json()) as T;
}

await t.test("write and read back from shared dict", async (t) => {
  const res = await get<{ stored: string }>("/write-and-read");
  t.equal(res.stored, '{"tokens":42}');
  t.end();
});

await t.test(
  "concurrent keys with different request IDs do not collide",
  async (t) => {
    const res = await get<{ a: string; b: string }>("/concurrent-keys");
    t.equal(res.a, '{"request":"first"}');
    t.equal(res.b, '{"request":"second"}');
    t.end();
  },
);

await t.test("same composite key overwrites previous value", async (t) => {
  const res = await get<{ stored: string }>("/overwrite");
  t.equal(res.stored, '{"attempt":2}');
  t.end();
});

await t.test("flush with premature flag leaves dict untouched", async (t) => {
  const res = await get<{ stored: string }>("/flush-premature");
  t.equal(res.stored, '{"data":"keep"}');
  t.end();
});

await t.test("flush with missing key is a safe no-op", async (t) => {
  const res = await get<{ stored: null }>("/flush-missing");
  t.equal(res.stored, null);
  t.end();
});
