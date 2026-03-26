#!/usr/bin/env pnpm tsx

import t from "tap";
import { processPaymentRequiredResponseMPP } from "./internal";
import { formatWWWAuthenticate } from "@faremeter/types/mpp";
import type {
  MPPPaymentHandler,
  mppChallengeParams,
} from "@faremeter/types/mpp";

function makeChallenge(
  overrides: Partial<mppChallengeParams> = {},
): mppChallengeParams {
  return {
    id: "test-id",
    realm: "test",
    method: "test-solana",
    intent: "charge",
    request: "dGVzdA",
    ...overrides,
  };
}

function makeResponse(challenges: mppChallengeParams[]): Response {
  const headers = new Headers();
  headers.set("WWW-Authenticate", formatWWWAuthenticate(challenges));
  return new Response(null, { status: 402, headers });
}

function makeMockHandler(): {
  handler: MPPPaymentHandler;
  calls: mppChallengeParams[];
} {
  const calls: mppChallengeParams[] = [];
  const handler: MPPPaymentHandler = async (challenge) => {
    calls.push(challenge);
    return {
      challenge,
      exec: async () => ({
        challenge,
        payload: { type: "transaction", transaction: "dGVzdA" },
      }),
    };
  };
  return { handler, calls };
}

await t.test("MPP challenge expiry", async (t) => {
  await t.test("skips expired challenges", async (t) => {
    const expired = makeChallenge({
      id: "expired",
      expires: String(Math.floor(Date.now() / 1000) - 10),
    });

    const { handler, calls } = makeMockHandler();
    const result = await processPaymentRequiredResponseMPP(
      makeResponse([expired]),
      [handler],
    );

    t.equal(result, undefined, "should not produce an authorization header");
    t.equal(
      calls.length,
      0,
      "handler should not be called for expired challenge",
    );
    t.end();
  });

  await t.test("accepts challenges without expires", async (t) => {
    const noExpiry = makeChallenge({ id: "no-expiry" });

    const { handler, calls } = makeMockHandler();
    const result = await processPaymentRequiredResponseMPP(
      makeResponse([noExpiry]),
      [handler],
    );

    t.ok(result, "should produce an authorization header");
    t.equal(calls.length, 1, "handler should be called");
    t.end();
  });

  await t.test("skips expired, uses valid", async (t) => {
    const expired = makeChallenge({
      id: "expired",
      expires: String(Math.floor(Date.now() / 1000) - 10),
    });
    const valid = makeChallenge({
      id: "valid",
      expires: String(Math.floor(Date.now() / 1000) + 60),
    });

    const { handler, calls } = makeMockHandler();
    const result = await processPaymentRequiredResponseMPP(
      makeResponse([expired, valid]),
      [handler],
    );

    t.ok(result, "should produce an authorization header");
    t.equal(calls.length, 1, "handler should be called once");
    t.equal(calls[0]?.id, "valid", "should use the non-expired challenge");
    t.end();
  });

  t.end();
});
