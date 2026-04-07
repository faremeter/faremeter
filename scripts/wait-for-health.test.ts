#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { waitForHealth } from "./wait-for-health";

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ server: Server; url: string }>((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        throw new Error("expected AddressInfo from server.address()");
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}/health` });
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

await t.test("resolves immediately when the server is healthy", async (t) => {
  const { server, url } = await listen((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });

  await waitForHealth(url, { timeoutMs: 1_000, initialDelayMs: 5 });
  await close(server);
  t.pass();
});

await t.test("retries until the server becomes healthy", async (t) => {
  let calls = 0;
  const { server, url } = await listen((_req, res) => {
    calls += 1;
    if (calls < 3) {
      res.statusCode = 503;
      res.end("starting");
      return;
    }
    res.statusCode = 200;
    res.end("ok");
  });

  await waitForHealth(url, { timeoutMs: 2_000, initialDelayMs: 5 });
  t.equal(calls, 3, "polled three times");
  await close(server);
});

await t.test("throws when the server never returns a 2xx", async (t) => {
  const { server, url } = await listen((_req, res) => {
    res.statusCode = 503;
    res.end("not ready");
  });

  await t.rejects(
    waitForHealth(url, {
      timeoutMs: 100,
      initialDelayMs: 5,
      maxDelayMs: 20,
    }),
    /timed out waiting for/,
  );
  await close(server);
});

await t.test("throws when the connection is refused", async (t) => {
  const { server, url } = await listen(() => {
    /* unused */
  });
  await close(server);

  await t.rejects(
    waitForHealth(url, {
      timeoutMs: 100,
      initialDelayMs: 5,
      maxDelayMs: 20,
    }),
    /timed out waiting for/,
  );
});
