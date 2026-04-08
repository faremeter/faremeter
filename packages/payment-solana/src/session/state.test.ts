#!/usr/bin/env pnpm tsx

import t from "tap";
import { address } from "@solana/kit";
import { createInMemorySessionStore, type SessionState } from "./state";

const CHANNEL = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const SESSION_KEY = address("DFo9vd1eiRFGQuCkReqvZvRPJVwwYu8NwCiaa9tB5pWZ");
const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
  channelId: CHANNEL,
  sessionKey: SESSION_KEY,
  mint: MINT,
  escrowedAmount: 1_000_000n,
  acceptedCumulative: 0n,
  spent: 0n,
  inFlightAuthorizationIds: [],
  status: "open",
  ...overrides,
});

await t.test("in-memory store round-trips a session", async (t) => {
  const store = createInMemorySessionStore();
  t.equal(await store.get(CHANNEL), undefined);

  await store.put(makeState({ acceptedCumulative: 100n }));
  const fetched = await store.get(CHANNEL);
  t.ok(fetched);
  t.equal(fetched?.acceptedCumulative, 100n);
  t.end();
});

await t.test("in-memory store keys by channelId", async (t) => {
  const store = createInMemorySessionStore();
  const otherChannel = address("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");
  await store.put(makeState({ acceptedCumulative: 1n }));
  await store.put(
    makeState({ channelId: otherChannel, acceptedCumulative: 2n }),
  );
  t.equal((await store.get(CHANNEL))?.acceptedCumulative, 1n);
  t.equal((await store.get(otherChannel))?.acceptedCumulative, 2n);
  t.end();
});

await t.test("in-memory store delete removes the entry", async (t) => {
  const store = createInMemorySessionStore();
  await store.put(makeState());
  await store.delete(CHANNEL);
  t.equal(await store.get(CHANNEL), undefined);
  t.end();
});

await t.test("iterate yields each live session", async (t) => {
  const store = createInMemorySessionStore();
  await store.put(makeState({ acceptedCumulative: 1n }));
  await store.put(
    makeState({
      channelId: address("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"),
      acceptedCumulative: 2n,
    }),
  );
  const collected: bigint[] = [];
  for await (const state of store.iterate()) {
    collected.push(state.acceptedCumulative);
  }
  collected.sort((a, b) => Number(a - b));
  t.matchOnly(collected, [1n, 2n]);
  t.end();
});

await t.test("put clones state so mutations don't leak", async (t) => {
  const store = createInMemorySessionStore();
  const initial = makeState({ inFlightAuthorizationIds: [1n] });
  await store.put(initial);
  initial.inFlightAuthorizationIds.push(2n);
  const fetched = await store.get(CHANNEL);
  t.equal(fetched?.inFlightAuthorizationIds.length, 1);
  t.end();
});
