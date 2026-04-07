#!/usr/bin/env pnpm tsx

import t from "tap";
import { generateChallengeID, verifyChallengeID } from "./challenge";
import type { mppChallengeParams } from "./types";

const secret = new TextEncoder().encode("test-secret-abcdefghijklmno");

const baseParams: Omit<mppChallengeParams, "id"> = {
  realm: "example",
  method: "solana",
  intent: "charge",
  request: "dGVzdA",
  expires: "1700000000",
};

await t.test("generateChallengeID is deterministic", async (t) => {
  const a = await generateChallengeID(secret, baseParams);
  const b = await generateChallengeID(secret, baseParams);
  t.equal(a, b);
  t.end();
});

await t.test("generateChallengeID differs by input", async (t) => {
  const a = await generateChallengeID(secret, baseParams);
  const b = await generateChallengeID(secret, {
    ...baseParams,
    intent: "session",
  });
  t.not(a, b);
  t.end();
});

await t.test("verifyChallengeID round trip", async (t) => {
  const id = await generateChallengeID(secret, baseParams);
  const ok = await verifyChallengeID(secret, { id, ...baseParams });
  t.ok(ok);
  t.end();
});

await t.test("verifyChallengeID rejects tampered ID", async (t) => {
  const id = await generateChallengeID(secret, baseParams);
  const tampered = id.slice(0, -1) + (id.endsWith("A") ? "B" : "A");
  const ok = await verifyChallengeID(secret, { id: tampered, ...baseParams });
  t.notOk(ok);
  t.end();
});

await t.test("verifyChallengeID rejects wrong secret", async (t) => {
  const id = await generateChallengeID(secret, baseParams);
  const otherSecret = new TextEncoder().encode("different-secret-xxxxxxxxxx");
  const ok = await verifyChallengeID(otherSecret, { id, ...baseParams });
  t.notOk(ok);
  t.end();
});

await t.test("verifyChallengeID rejects mismatched params", async (t) => {
  const id = await generateChallengeID(secret, baseParams);
  const ok = await verifyChallengeID(secret, {
    id,
    ...baseParams,
    request: "b3RoZXI",
  });
  t.notOk(ok);
  t.end();
});

await t.test("optional fields round-trip", async (t) => {
  const params: Omit<mppChallengeParams, "id"> = {
    ...baseParams,
    digest: "sha-256=:abc:",
    opaque: "opq",
  };
  const id = await generateChallengeID(secret, params);
  const ok = await verifyChallengeID(secret, { id, ...params });
  t.ok(ok);
  const okWithoutDigest = await verifyChallengeID(secret, {
    id,
    ...baseParams,
    opaque: "opq",
  });
  t.notOk(okWithoutDigest);
  t.end();
});
