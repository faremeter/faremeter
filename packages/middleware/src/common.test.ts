#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  findMatchingPaymentRequirements,
  handleMiddlewareRequest,
  resolveSupportedVersions,
} from "./common";
import type {
  MPPMethodHandler,
  mppChallengeParams,
  mppCredential,
} from "@faremeter/types/mpp";
import {
  AUTHORIZATION_HEADER,
  MPP_PAYMENT_SCHEME,
  serializeCredential,
} from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";

await t.test("findMatchingPaymentRequirements", async (t) => {
  await t.test(
    "matches v1 payload with CAIP-2 network against legacy network",
    async (t) => {
      const accepts = [
        {
          scheme: "exact",
          network: "eip155:84532",
          maxAmountRequired: "10000",
          resource: "http://localhost:3000/protected",
          description: "",
          mimeType: "",
          payTo: "0xrecipient",
          maxTimeoutSeconds: 60,
          asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        },
      ];

      const payload = {
        x402Version: 1 as const,
        scheme: "exact",
        network: "base-sepolia",
        asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        payload: { signature: "0xabc" },
      };

      const result = findMatchingPaymentRequirements(accepts, payload);
      t.ok(result, "should match despite network format difference");
      t.equal(result?.network, "eip155:84532");
      t.end();
    },
  );

  await t.test(
    "matches v1 payload when networks are already the same format",
    async (t) => {
      const accepts = [
        {
          scheme: "exact",
          network: "eip155:84532",
          maxAmountRequired: "10000",
          resource: "http://localhost/protected",
          description: "",
          mimeType: "",
          payTo: "0xrecipient",
          maxTimeoutSeconds: 60,
          asset: "0xtoken",
        },
      ];

      const payload = {
        x402Version: 1 as const,
        scheme: "exact",
        network: "eip155:84532",
        asset: "0xtoken",
        payload: { signature: "0xabc" },
      };

      const result = findMatchingPaymentRequirements(accepts, payload);
      t.ok(result, "should match when networks are identical");
      t.end();
    },
  );

  await t.test("returns undefined when no match", async (t) => {
    const accepts = [
      {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "10000",
        resource: "http://localhost/protected",
        description: "",
        mimeType: "",
        payTo: "0xrecipient",
        maxTimeoutSeconds: 60,
        asset: "0xtoken",
      },
    ];

    const payload = {
      x402Version: 1 as const,
      scheme: "exact",
      network: "eip155:1",
      asset: "0xtoken",
      payload: { signature: "0xabc" },
    };

    const result = findMatchingPaymentRequirements(accepts, payload);
    t.equal(result, undefined, "should not match different networks");
    t.end();
  });

  t.end();
});

await t.test("MPP digest binding", async (t) => {
  const pricing: ResourcePricing[] = [
    {
      amount: "1",
      asset: "test-asset",
      recipient: "test-recipient",
      network: "test-network",
    },
  ];

  const makeHandler = (challengeDigest?: string): MPPMethodHandler => {
    const challenge: mppChallengeParams = {
      id: "challenge-id",
      realm: "test",
      method: "test-method",
      intent: "test-intent",
      request: "req",
      ...(challengeDigest !== undefined ? { digest: challengeDigest } : {}),
    };
    return {
      method: "test-method",
      capabilities: { networks: [], assets: [] },
      getSupportedIntents: () => ["test-intent"],
      getChallenge: async () => challenge,
      handleSettle: async () => ({
        status: "success" as const,
        method: "test-method",
        intent: "test-intent",
        timestamp: new Date().toISOString(),
        reference: "ref",
      }),
    };
  };

  const runRequest = async (args: {
    handler: MPPMethodHandler;
    body: ArrayBuffer | null;
    credentialDigest?: string;
  }) => {
    const pricingEntry = pricing[0];
    if (!pricingEntry) throw new Error("pricing entry missing");
    const challenge = await args.handler.getChallenge(
      "test-intent",
      pricingEntry,
      "http://test/resource",
    );
    const credential: mppCredential = {
      challenge: {
        ...challenge,
        ...(args.credentialDigest !== undefined
          ? { digest: args.credentialDigest }
          : {}),
      },
      payload: {},
    };
    const authHeader = `${MPP_PAYMENT_SCHEME} ${serializeCredential(credential)}`;

    let bodyCalled = false;
    let lastStatus: number | undefined;

    await handleMiddlewareRequest<string>({
      mppMethodHandlers: [args.handler],
      pricing,
      resource: "http://test/resource",
      supportedVersions: resolveSupportedVersions(undefined),
      getHeader: (key) =>
        key.toLowerCase() === AUTHORIZATION_HEADER.toLowerCase()
          ? authHeader
          : undefined,
      getBody: async () => args.body,
      sendJSONResponse: (status) => {
        lastStatus = status;
        return `status:${status}`;
      },
      body: async () => {
        bodyCalled = true;
        return "ok";
      },
    });

    return { bodyCalled, lastStatus };
  };

  await t.test(
    "challenge without digest accepts body-bearing request",
    async (t) => {
      const body = new TextEncoder().encode(
        JSON.stringify({ hello: "world" }),
      ).buffer;
      const result = await runRequest({
        handler: makeHandler(),
        body,
      });
      t.ok(
        result.bodyCalled,
        "body callback should fire when challenge has no digest",
      );
      t.end();
    },
  );

  await t.test(
    "challenge with digest still enforces match against body",
    async (t) => {
      const body = new TextEncoder().encode(
        JSON.stringify({ hello: "world" }),
      ).buffer;
      const result = await runRequest({
        handler: makeHandler("sha-256=:wrong:"),
        body,
        credentialDigest: "sha-256=:wrong:",
      });
      t.notOk(
        result.bodyCalled,
        "body callback should not fire when digests mismatch request body",
      );
      t.equal(result.lastStatus, 402, "should re-challenge on digest mismatch");
      t.end();
    },
  );

  t.end();
});
