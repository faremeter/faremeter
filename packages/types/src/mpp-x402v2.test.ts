#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  parseMPPChallenge,
  mppChallengeToX402Requirements,
  formatMPPCredential,
} from "./mpp-x402v2";
import { encodeBase64url } from "./base64url";

await t.test("parseMPPChallenge", async (t) => {
  await t.test("parses valid challenge", (t) => {
    const challenge = parseMPPChallenge(
      'Payment id="abc", realm="api.example.com", method="exact", intent="charge", request="eyJhbW91bnQiOiIxMDAwIiwiY3VycmVuY3kiOiJ1c2QifQ"',
    );

    t.equal(challenge.id, "abc");
    t.equal(challenge.realm, "api.example.com");
    t.equal(challenge.method, "exact");
    t.equal(challenge.intent, "charge");
    t.end();
  });

  await t.test("throws on missing Payment prefix", (t) => {
    t.throws(() => parseMPPChallenge('id="abc"'));
    t.end();
  });
});

await t.test("mppChallengeToX402Requirements", async (t) => {
  await t.test("converts MPP to x402v2", (t) => {
    const challenge = {
      id: "abc",
      realm: "api.example.com",
      method: "exact",
      intent: "charge",
      request: encodeBase64url(
        JSON.stringify({
          amount: "1000",
          currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          recipient: "0x1234567890123456789012345678901234567890",
          methodDetails: { network: "eip155:84532" },
        }),
      ),
    };

    const req = mppChallengeToX402Requirements(challenge);

    t.equal(req.scheme, "exact");
    t.equal(req.network, "eip155:84532");
    t.equal(req.amount, "1000");
    t.equal(req.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    t.end();
  });

  await t.test("throws on expired challenge", (t) => {
    const challenge = {
      id: "abc",
      realm: "api.example.com",
      method: "exact",
      intent: "charge",
      expires: new Date(Date.now() - 60000).toISOString(),
      request: encodeBase64url(
        JSON.stringify({
          amount: "1000",
          currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          methodDetails: { network: "eip155:84532" },
        }),
      ),
    };

    t.throws(() => mppChallengeToX402Requirements(challenge));
    t.end();
  });

  await t.test("throws on missing network in methodDetails", (t) => {
    const challenge = {
      id: "abc",
      realm: "api.example.com",
      method: "exact",
      intent: "charge",
      request: encodeBase64url(
        JSON.stringify({
          amount: "1000",
          currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          methodDetails: {},
        }),
      ),
    };

    t.throws(() => mppChallengeToX402Requirements(challenge));
    t.end();
  });

  await t.test("throws on unsupported intent", (t) => {
    const challenge = {
      id: "abc",
      realm: "api.example.com",
      method: "exact",
      intent: "subscription",
      request: encodeBase64url(
        JSON.stringify({
          amount: "1000",
          currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          methodDetails: { network: "eip155:84532" },
        }),
      ),
    };

    t.throws(() => mppChallengeToX402Requirements(challenge));
    t.end();
  });
});

await t.test("formatMPPCredential", async (t) => {
  await t.test("produces base64url output without padding", (t) => {
    const credential = {
      challenge: {
        id: "test",
        realm: "example.com",
        method: "exact",
        intent: "charge",
        request: "dGVzdA",
      },
      payload: { key: "value" },
    };

    const result = formatMPPCredential(credential);

    t.ok(!result.includes("="), "should not contain padding");
    t.ok(!result.includes("+"), "should not contain +");
    t.ok(!result.includes("/"), "should not contain /");
    t.end();
  });
});
