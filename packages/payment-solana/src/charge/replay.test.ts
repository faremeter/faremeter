#!/usr/bin/env pnpm tsx

import t from "tap";

import { createInMemoryReplayStore } from "./replay";
import type { ReplayStore } from "./replay";

async function claim(store: ReplayStore, id: string, expiresAt?: number) {
  return store.claim(id, expiresAt);
}

await t.test("in-memory replay store claims IDs once", async (t) => {
  const store = createInMemoryReplayStore();

  t.equal(await claim(store, "signature-a"), true);
  t.equal(await claim(store, "signature-a"), false);
  t.end();
});

await t.test("in-memory replay store expires claimed IDs", async (t) => {
  const store = createInMemoryReplayStore();

  t.equal(await claim(store, "signature-a", Date.now() - 1), true);
  t.equal(await claim(store, "signature-a"), true);
  t.end();
});

await t.test("in-memory replay store releases claimed IDs", async (t) => {
  const store = createInMemoryReplayStore();

  t.equal(await claim(store, "signature-a"), true);
  t.equal(await claim(store, "signature-a"), false);
  await store.release("signature-a");
  t.equal(await claim(store, "signature-a"), true);
  t.end();
});

await t.test("in-memory replay store consumes pre-added IDs", async (t) => {
  const store = createInMemoryReplayStore();

  await store.add("challenge-a");
  t.equal(await store.consume("challenge-a"), true);
  t.equal(await store.consume("challenge-a"), false);
  t.end();
});
