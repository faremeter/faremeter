#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  TestHarness,
  createTestMPPHandler,
  createTestMPPPaymentHandler,
  createTestFacilitatorHandler,
  createTestPaymentHandler,
  TEST_NETWORK,
  TEST_ASSET,
  isResourceContextMPP,
} from "@faremeter/test-harness";
import type { ResourcePricing } from "@faremeter/types/pricing";
import {
  parseWWWAuthenticate,
  serializeCredential,
} from "@faremeter/types/mpp";

const pricing: ResourcePricing[] = [
  {
    amount: "100",
    asset: TEST_ASSET,
    recipient: "test-receiver",
    network: TEST_NETWORK,
  },
];

await t.test("MPP basic payment flow", async (t) => {
  await t.test("settle-only mode completes successfully", async (t) => {
    const harness = new TestHarness({
      mppMethodHandlers: [createTestMPPHandler()],
      mppClientHandlers: [createTestMPPPaymentHandler()],
      pricing,
      clientHandlers: [],
      settleMode: "settle-only",
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200, "should complete MPP payment flow");

    const body = (await response.json()) as { success: boolean };
    t.ok(body.success, "resource should return success");

    t.end();
  });

  await t.test(
    "402 response includes WWW-Authenticate Payment header",
    async (t) => {
      const harness = new TestHarness({
        mppMethodHandlers: [createTestMPPHandler()],
        mppClientHandlers: [],
        pricing,
        clientHandlers: [],
        settleMode: "settle-only",
      });

      const clientFetch = harness.createClientFetch();
      const response = await clientFetch("/test-resource");

      t.equal(response.status, 402, "should return 402");

      const wwwAuth = response.headers.get("WWW-Authenticate");
      t.ok(wwwAuth, "should have WWW-Authenticate header");

      const challenges = parseWWWAuthenticate(wwwAuth ?? "");
      t.ok(challenges.length > 0, "should have at least one challenge");

      const challenge = challenges[0];
      if (!challenge) {
        t.fail("no challenge parsed");
        t.end();
        return;
      }
      t.ok(challenge.id, "challenge should have id");
      t.ok(challenge.realm, "challenge should have realm");
      t.ok(challenge.method, "challenge should have method");
      t.ok(challenge.intent, "challenge should have intent");
      t.ok(challenge.request, "challenge should have request");

      t.end();
    },
  );

  await t.test("resource handler receives MPP context", async (t) => {
    let capturedProtocol: string | number | undefined;
    let wasCorrectType = false;

    const harness = new TestHarness({
      mppMethodHandlers: [createTestMPPHandler()],
      mppClientHandlers: [createTestMPPPaymentHandler()],
      pricing,
      clientHandlers: [],
      settleMode: "settle-only",
    });

    harness.setResourceHandler((ctx) => {
      capturedProtocol = ctx.protocolVersion;
      wasCorrectType = isResourceContextMPP(ctx);
      return {
        status: 200,
        body: { captured: true },
      };
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.equal(response.status, 200);
    t.equal(capturedProtocol, "mpp", "protocolVersion should be 'mpp'");
    t.ok(wasCorrectType, "context should be ResourceContextMPP");

    t.end();
  });

  await t.test(
    "multiple sequential requests each get fresh challenges",
    async (t) => {
      let challengeCount = 0;
      let settleCount = 0;

      const handler = createTestMPPHandler({
        onChallenge: () => {
          challengeCount++;
        },
        onSettle: () => {
          settleCount++;
        },
      });

      const harness = new TestHarness({
        mppMethodHandlers: [handler],
        mppClientHandlers: [createTestMPPPaymentHandler()],
        pricing,
        clientHandlers: [],
        settleMode: "settle-only",
      });

      const fetch = harness.createFetch();

      const response1 = await fetch("/test-resource");
      t.equal(response1.status, 200, "first request should succeed");

      const response2 = await fetch("/test-resource");
      t.equal(response2.status, 200, "second request should also succeed");

      t.ok(challengeCount >= 2, "should generate at least 2 challenges");
      t.ok(settleCount >= 2, "should settle at least 2 times");

      t.end();
    },
  );

  await t.test(
    "settling the same credential twice returns an error",
    async (t) => {
      const harness = new TestHarness({
        mppMethodHandlers: [createTestMPPHandler()],
        mppClientHandlers: [createTestMPPPaymentHandler()],
        pricing,
        clientHandlers: [],
        settleMode: "settle-only",
      });

      const clientFetch = harness.createClientFetch();

      // Get the 402 with MPP challenges
      const challengeResponse = await clientFetch("/test-resource");
      t.equal(challengeResponse.status, 402);

      const wwwAuth = challengeResponse.headers.get("WWW-Authenticate") ?? "";
      const challenges = parseWWWAuthenticate(wwwAuth);
      t.ok(challenges.length > 0, "should have at least one challenge");

      // Build a credential from the first challenge
      const challenge = challenges[0];
      if (!challenge) {
        t.fail("no challenge parsed");
        t.end();
        return;
      }
      const clientHandler = createTestMPPPaymentHandler();
      const execer = await clientHandler(challenge);
      if (!execer) {
        t.fail("client handler should match the challenge");
        t.end();
        return;
      }

      const credential = await execer.exec();
      const authHeader = `Payment ${serializeCredential(credential)}`;

      // First settlement should succeed
      const firstResponse = await clientFetch("/test-resource", {
        headers: { Authorization: authHeader },
      });
      t.equal(firstResponse.status, 200, "first settlement should succeed");

      // Same credential again should fail (challenge consumed)
      const replayResponse = await clientFetch("/test-resource", {
        headers: { Authorization: authHeader },
      });
      t.equal(
        replayResponse.status,
        402,
        "replayed credential should be rejected",
      );

      t.end();
    },
  );

  await t.test(
    "dual protocol: x402 and MPP coexist on same harness",
    async (t) => {
      const harness = new TestHarness({
        x402Handlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        mppMethodHandlers: [createTestMPPHandler()],
        pricing,
        clientHandlers: [createTestPaymentHandler()],
        mppClientHandlers: [createTestMPPPaymentHandler()],
        settleMode: "settle-only",
      });

      const clientFetch = harness.createClientFetch();
      const challengeResponse = await clientFetch("/test-resource");

      t.equal(challengeResponse.status, 402, "should return 402");

      const wwwAuth = challengeResponse.headers.get("WWW-Authenticate");
      t.ok(wwwAuth, "should have WWW-Authenticate header for MPP");

      const fetch = harness.createFetch();
      const response = await fetch("/test-resource");
      t.equal(response.status, 200, "payment should succeed via MPP");

      t.end();
    },
  );

  t.end();
});
