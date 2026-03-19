#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  TestHarness,
  createTestFacilitatorHandler,
  createTestPaymentHandler,
  accepts,
  createMPPResponseInterceptor,
  createFailureInterceptor,
  createNonMatchingHandler,
  matchFacilitatorSettle,
  matchFacilitatorAccepts,
  settleFailedResponseV2,
  networkError,
  httpError,
  suppressConsoleErrors,
  TEST_NETWORK,
} from "@faremeter/test-harness";
import type { Interceptor } from "@faremeter/test-harness";

await t.test("MPP failure paths", async (t) => {
  t.teardown(suppressConsoleErrors());

  await t.test("settlement rejected by facilitator", async (t) => {
    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
      middlewareInterceptors: [
        createFailureInterceptor(matchFacilitatorSettle, () =>
          settleFailedResponseV2("settlement_rejected", TEST_NETWORK),
        ),
      ],
    });

    const fetch = harness.createFetch();

    try {
      await fetch("/test-resource");
      t.fail("should throw an error");
    } catch (error) {
      t.ok(error instanceof Error, "should throw an error");
      if (error instanceof Error) {
        t.match(
          error.message,
          /failed to complete payment after retries/,
          "should exhaust retry loop on persistent settlement rejection",
        );
      }
    }

    t.end();
  });

  await t.test("settlement endpoint network error", async (t) => {
    let interceptorCalled = false;

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
      middlewareInterceptors: [
        createFailureInterceptor(matchFacilitatorSettle, () => {
          interceptorCalled = true;
          return networkError();
        }),
      ],
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.ok(interceptorCalled, "failure interceptor should have been called");
    t.equal(
      response.status,
      500,
      "should return 500 when settlement endpoint is unreachable",
    );

    t.end();
  });

  await t.test("settlement endpoint HTTP 500", async (t) => {
    let interceptorCalled = false;

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
      middlewareInterceptors: [
        createFailureInterceptor(matchFacilitatorSettle, () => {
          interceptorCalled = true;
          return httpError(500, "Internal Server Error");
        }),
      ],
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.ok(interceptorCalled, "failure interceptor should have been called");
    t.equal(
      response.status,
      500,
      "should return 500 when settlement returns HTTP 500",
    );

    t.end();
  });

  await t.test(
    "handler returning success:false exhausts retries",
    async (t) => {
      const base = createTestFacilitatorHandler({ payTo: "test-receiver" });
      const failingHandler = {
        ...base,
        handleSettle: async () => ({
          success: false,
          errorReason: "Insufficient funds for transfer",
          transaction: "",
          network: TEST_NETWORK,
          payer: "",
        }),
      };

      const harness = new TestHarness({
        supportedVersions: { mpp: true },
        settleMode: "settle-only",
        accepts: [accepts()],
        facilitatorHandlers: [failingHandler],
        clientHandlers: [createTestPaymentHandler()],
        clientInterceptors: [createMPPResponseInterceptor()],
      });

      const fetch = harness.createFetch();

      try {
        await fetch("/test-resource");
        t.fail("should throw an error");
      } catch (error) {
        t.ok(error instanceof Error, "should throw an error");
        if (error instanceof Error) {
          t.match(
            error.message,
            /failed to complete payment after retries/,
            "should exhaust retries when handler returns success:false",
          );
        }
      }

      t.end();
    },
  );

  await t.test("handler throwing exception exhausts retries", async (t) => {
    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({
          payTo: "test-receiver",
          onSettle: () => {
            throw new Error("Transaction simulation failed");
          },
        }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
    });

    const fetch = harness.createFetch();

    try {
      await fetch("/test-resource");
      t.fail("should throw an error");
    } catch (error) {
      t.ok(error instanceof Error, "should throw an error");
      if (error instanceof Error) {
        t.match(
          error.message,
          /failed to complete payment after retries/,
          "should exhaust retries when handler throws",
        );
      }
    }

    t.end();
  });

  await t.test("no matching client handler for MPP challenge", async (t) => {
    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createNonMatchingHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
    });

    const fetch = harness.createFetch();

    try {
      await fetch("/test-resource");
      t.fail("should throw when no client handler matches");
    } catch (error) {
      t.ok(error instanceof Error, "should throw an error");
      if (error instanceof Error) {
        t.match(
          error.message,
          /No payment handler matched MPP challenge/,
          "should indicate no handler matched the MPP challenge",
        );
      }
    }

    t.end();
  });

  await t.test(
    "malformed MPP credential degrades to 402 re-challenge",
    async (t) => {
      let corruptedCount = 0;

      const corruptAuthorization: Interceptor =
        (fetch) => async (input, init) => {
          const headers = new Headers(init?.headers);
          if (headers.has("Authorization")) {
            corruptedCount++;
            headers.set("Authorization", "Payment not-valid-base64!!!");
            return fetch(input, { ...init, headers });
          }
          return fetch(input, init);
        };

      const harness = new TestHarness({
        supportedVersions: { mpp: true },
        settleMode: "settle-only",
        accepts: [accepts()],
        facilitatorHandlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        clientHandlers: [createTestPaymentHandler()],
        clientInterceptors: [
          createMPPResponseInterceptor(),
          corruptAuthorization,
        ],
      });

      const fetch = harness.createFetch();

      try {
        await fetch("/test-resource");
        t.fail("should throw an error");
      } catch (error) {
        t.ok(error instanceof Error, "should throw an error");
        if (error instanceof Error) {
          t.match(
            error.message,
            /failed to complete payment after retries/,
            "should exhaust retries when credential is malformed",
          );
        }
      }

      t.ok(corruptedCount > 0, "should have corrupted at least one credential");

      t.end();
    },
  );

  await t.test(
    "MPP credential rejected when server does not support MPP",
    async (t) => {
      const harness = new TestHarness({
        supportedVersions: { x402v2: true },
        settleMode: "settle-only",
        accepts: [accepts()],
        facilitatorHandlers: [
          createTestFacilitatorHandler({ payTo: "test-receiver" }),
        ],
        clientHandlers: [createTestPaymentHandler()],
        clientInterceptors: [createMPPResponseInterceptor()],
      });

      const fetch = harness.createFetch();
      const response = await fetch("/test-resource");

      t.equal(
        response.status,
        400,
        "should return 400 when server does not support MPP",
      );

      const body = (await response.json()) as { error: string };
      t.match(
        body.error,
        /does not support MPP/,
        "should indicate MPP is not supported",
      );

      t.end();
    },
  );

  await t.test("expired MPP challenge triggers re-challenge", async (t) => {
    const expiredChallengeInterceptor: Interceptor =
      (baseFetch) => async (input, init) => {
        const response = await baseFetch(input, init);

        if (response.status !== 402) {
          return response;
        }

        const wwwAuth = response.headers.get("WWW-Authenticate");
        if (!wwwAuth) {
          return response;
        }

        // Replace the expires value with an already-expired timestamp
        const expired = new Date(Date.now() - 60_000).toISOString();
        const modified = wwwAuth.replace(
          /expires="[^"]*"/,
          `expires="${expired}"`,
        );

        const newHeaders = new Headers();
        newHeaders.set("WWW-Authenticate", modified);

        return new Response(null, {
          status: 402,
          statusText: "Payment Required",
          headers: newHeaders,
        });
      };

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [
        expiredChallengeInterceptor,
        createMPPResponseInterceptor(),
      ],
    });

    const fetch = harness.createFetch();

    try {
      await fetch("/test-resource");
      t.fail("should throw an error");
    } catch (error) {
      t.ok(error instanceof Error, "should throw an error");
    }

    t.end();
  });

  await t.test("accepts endpoint network error", async (t) => {
    let interceptorCalled = false;

    const harness = new TestHarness({
      supportedVersions: { mpp: true },
      settleMode: "settle-only",
      accepts: [accepts()],
      facilitatorHandlers: [
        createTestFacilitatorHandler({ payTo: "test-receiver" }),
      ],
      clientHandlers: [createTestPaymentHandler()],
      clientInterceptors: [createMPPResponseInterceptor()],
      middlewareInterceptors: [
        createFailureInterceptor(matchFacilitatorAccepts, () => {
          interceptorCalled = true;
          return networkError("connection refused");
        }),
      ],
    });

    const fetch = harness.createFetch();
    const response = await fetch("/test-resource");

    t.ok(interceptorCalled, "failure interceptor should have been called");
    t.equal(
      response.status,
      500,
      "should return 500 when accepts endpoint is unreachable",
    );

    t.end();
  });
});
