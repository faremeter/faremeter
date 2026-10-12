#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  formatWWWAuthenticate,
  type mppChallengeParams,
  type MPPPaymentHandler,
} from "@faremeter/types/mpp";
import { processPaymentRequiredResponseMPP } from "./internal";

const challenge: mppChallengeParams = {
  id: "test-id",
  realm: "test",
  method: "test-method",
  intent: "charge",
  request: "dGVzdA",
};
const handler: MPPPaymentHandler = async (challenge) => ({
  challenge,
  exec: async () => ({ challenge, payload: {} }),
});
function createResponse(challenges: mppChallengeParams[]) {
  return new Response(null, {
    status: 402,
    headers: { "WWW-Authenticate": formatWWWAuthenticate(challenges) },
  });
}

await t.test("MPP skips unused digest readers", async (t) => {
  let reads = 0;
  const opts = {
    getBodyDigest: async () => {
      reads++;
      return "sha-256=test";
    },
  };
  t.equal(
    await processPaymentRequiredResponseMPP(
      new Response(null),
      [handler],
      opts,
    ),
    undefined,
  );
  t.ok(
    await processPaymentRequiredResponseMPP(
      createResponse([challenge]),
      [handler],
      opts,
    ),
  );
  t.equal(
    await processPaymentRequiredResponseMPP(
      createResponse([{ ...challenge, digest: "sha-256=test", expires: "0" }]),
      [handler],
      opts,
    ),
    undefined,
  );
  t.equal(reads, 0);
});

await t.test(
  "MPP reads a digest once across candidate challenges",
  async (t) => {
    let reads = 0;
    const seen: string[] = [];
    const recordingHandler: MPPPaymentHandler = async (value) => {
      seen.push(value.id);
      return await handler(value);
    };
    t.ok(
      await processPaymentRequiredResponseMPP(
        createResponse([
          { ...challenge, id: "wrong", digest: "sha-256=wrong" },
          { ...challenge, id: "right", digest: "sha-256=test" },
        ]),
        [recordingHandler],
        {
          getBodyDigest: async () => {
            reads++;
            return "sha-256=test";
          },
        },
      ),
    );
    t.equal(reads, 1);
    t.same(seen, ["right"]);
  },
);

await t.test("MPP keeps supplied digest precedence", async (t) => {
  let reads = 0;
  t.ok(
    await processPaymentRequiredResponseMPP(
      createResponse([{ ...challenge, digest: "sha-256=test" }]),
      [handler],
      {
        bodyDigest: "sha-256=test",
        getBodyDigest: async () => {
          reads++;
          return "sha-256=wrong";
        },
      },
    ),
  );
  t.equal(reads, 0);
});

await t.test("MPP rejects a missing digest without signing", async (t) => {
  let calls = 0;
  const recordingHandler: MPPPaymentHandler = async (value) => {
    calls++;
    return await handler(value);
  };
  t.equal(
    await processPaymentRequiredResponseMPP(
      createResponse([{ ...challenge, digest: "sha-256=test" }]),
      [recordingHandler],
      { getBodyDigest: async () => undefined },
    ),
    undefined,
  );
  t.equal(calls, 0);
});
