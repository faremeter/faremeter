#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  createTestFacilitatorHandler,
  createTestMPPHandler,
  TEST_SCHEME,
  TEST_NETWORK,
  TEST_ASSET,
  TEST_MPP_METHOD,
  generateTestId,
} from "@faremeter/test-harness";
import {
  createGatewayHandler,
  extractSpec,
} from "@faremeter/middleware-openapi";
import type { Asset, FaremeterSpec } from "@faremeter/middleware-openapi";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import { createTestMPPPaymentHandler } from "@faremeter/test-harness";
import {
  parseWWWAuthenticate,
  serializeCredential,
} from "@faremeter/types/mpp";

const OP = "POST /v1/chat/completions";
const PAY_TO = "test-receiver";
const BASE_URL = "http://test-gateway";

const TEST_SPEC_ASSETS: Record<string, Asset> = {
  test: {
    chain: TEST_NETWORK,
    token: TEST_ASSET,
    decimals: 6,
    recipient: PAY_TO,
  },
};

function makeSpecWithPolicy(
  policy: FaremeterSpec["operations"][string]["policy"],
  rules: FaremeterSpec["operations"][string]["rules"] = [
    { match: "$", capture: "100" },
  ],
): FaremeterSpec {
  const operationPricing: FaremeterSpec["operations"][string] = {
    method: "POST",
    path: "/v1/chat/completions",
    transport: "json",
    rates: { test: 1n },
    rules,
  };
  if (policy !== undefined) {
    operationPricing.policy = policy;
  }
  return {
    assets: TEST_SPEC_ASSETS,
    operations: { [OP]: operationPricing },
  };
}

function makeV2PaymentHeader(scheme: string, amount: string): string {
  const payload = {
    x402Version: 2,
    resource: { url: `${BASE_URL}/v1/chat/completions` },
    accepted: {
      scheme,
      network: TEST_NETWORK,
      amount,
      asset: TEST_ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
    },
    payload: {
      testId: generateTestId(),
      amount,
      timestamp: Date.now(),
    },
  };
  return btoa(JSON.stringify(payload));
}

function makeSettleOnlyX402Handler(opts: {
  payTo: string;
  onSettle?: Parameters<typeof createTestFacilitatorHandler>[0]["onSettle"];
  onVerify?: Parameters<typeof createTestFacilitatorHandler>[0]["onVerify"];
}) {
  const constructorOpts: Parameters<typeof createTestFacilitatorHandler>[0] = {
    payTo: opts.payTo,
  };
  if (opts.onSettle) constructorOpts.onSettle = opts.onSettle;
  if (opts.onVerify) constructorOpts.onVerify = opts.onVerify;
  const handler = createTestFacilitatorHandler(constructorOpts);
  delete (handler as { handleVerify?: unknown }).handleVerify;
  return handler;
}

// Construct a second x402 handler that advertises a different scheme
// so behavioural tests have something to filter against. The shared
// test facilitator hardcodes TEST_SCHEME (its getRequirements and
// isMatchingRequirement filter by scheme), so we hand-roll a minimal
// FacilitatorHandler that accepts any scheme it is registered for.
function makeNamedSchemeHandler(scheme: string): FacilitatorHandler {
  return {
    capabilities: { networks: [TEST_NETWORK], assets: [TEST_ASSET] },
    schemes: [scheme],
    getRequirements: async ({ accepts }) => accepts,
    handleSettle: async (req) => ({
      success: true,
      transaction: `${scheme}-tx`,
      network: req.network,
      payer: "test-payer",
    }),
  };
}

await t.test("openapi gateway: PaymentPolicy behavioural", async (t) => {
  await t.test("disallowed scheme filtered out of 402 challenge", async (t) => {
    // Two handlers registered (TEST_SCHEME and permit2); allow only
    // permits permit2. The 402 must advertise permit2 but not
    // TEST_SCHEME.
    const spec = makeSpecWithPolicy({ allow: ["x402:permit2"] });
    const handler = createGatewayHandler({
      spec,
      baseURL: BASE_URL,
      supportedVersions: { x402v1: false, x402v2: true },
      x402Handlers: [
        createTestFacilitatorHandler({ payTo: PAY_TO }),
        makeNamedSchemeHandler("permit2"),
      ],
    });

    const result = await handler.handleRequest({
      operationKey: OP,
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
      query: {},
      body: { model: "gpt-4o" },
    });
    t.equal(result.status, 402, "must return 402");
    const v2Header = result.headers?.["PAYMENT-REQUIRED"];
    if (!v2Header) {
      t.fail("expected PAYMENT-REQUIRED header");
      t.end();
      return;
    }
    const parsed = JSON.parse(atob(v2Header)) as {
      accepts: { scheme: string }[];
    };
    const schemes = parsed.accepts.map((a) => a.scheme);
    t.equal(parsed.accepts.length, 1, "exactly one allowed scheme");
    t.equal(schemes[0], "permit2", "only the allowed scheme is advertised");
    t.notOk(
      schemes.includes(TEST_SCHEME),
      "disallowed scheme must be filtered out",
    );
    t.end();
  });

  await t.test(
    "allowed scheme accepted via 402 challenge and settlement",
    async (t) => {
      // allow lists the handler's scheme -> 402 advertises it and
      // a payment signed for that scheme settles.
      const settleCalls: { scheme: string }[] = [];
      const spec = makeSpecWithPolicy({ allow: [`x402:${TEST_SCHEME}`] });
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            onSettle: (r) => settleCalls.push({ scheme: r.scheme }),
          }),
        ],
      });

      const challenge = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(challenge.status, 402, "must return 402");
      const v2Header = challenge.headers?.["PAYMENT-REQUIRED"];
      if (!v2Header) {
        t.fail("expected PAYMENT-REQUIRED header");
        t.end();
        return;
      }
      const parsed = JSON.parse(atob(v2Header)) as {
        accepts: { scheme: string }[];
      };
      t.equal(parsed.accepts.length, 1, "exactly one allowed scheme");
      t.equal(parsed.accepts[0]?.scheme, TEST_SCHEME);

      const pay = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {
          "PAYMENT-SIGNATURE": makeV2PaymentHeader(TEST_SCHEME, "100"),
        },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(pay.status, 200, "allowed scheme settles");
      t.equal(settleCalls.length, 1, "facilitator settle fired once");
      t.end();
    },
  );

  await t.test(
    "empty allow denies all schemes -> 402 with no challenges",
    async (t) => {
      // allow: [] is the deny-all sentinel.
      const spec = makeSpecWithPolicy({ allow: [] });
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
      });

      const result = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {},
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(result.status, 402, "must return 402");
      const v2Header = result.headers?.["PAYMENT-REQUIRED"];
      if (!v2Header) {
        t.fail("expected PAYMENT-REQUIRED header");
        t.end();
        return;
      }
      const parsed = JSON.parse(atob(v2Header)) as {
        accepts: { scheme: string }[];
      };
      t.equal(parsed.accepts.length, 0, "deny-all -> no challenges");
      t.end();
    },
  );

  await t.test(
    "pin capturesAt=request forces one-phase on a verify-capable handler",
    async (t) => {
      // Two-phase rule + verify-capable handler would normally
      // resolve to capturesAt=response. Pin forces capturesAt=request,
      // settling at /request for the authorize amount; /response is
      // a no-op.
      const verifyCalls: { amount: string }[] = [];
      const settleCalls: { amount: string }[] = [];

      const spec = makeSpecWithPolicy(
        {
          pin: { [`x402:${TEST_SCHEME}`]: { capturesAt: "request" } },
        },
        [{ match: "$", authorize: "100", capture: "50" }],
      );
      const handler = createGatewayHandler({
        spec,
        baseURL: BASE_URL,
        supportedVersions: { x402v1: false, x402v2: true },
        x402Handlers: [
          createTestFacilitatorHandler({
            payTo: PAY_TO,
            onVerify: (r) => verifyCalls.push({ amount: r.amount }),
            onSettle: (r) => settleCalls.push({ amount: r.amount }),
          }),
        ],
      });

      const requestResult = await handler.handleRequest({
        operationKey: OP,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {
          "PAYMENT-SIGNATURE": makeV2PaymentHeader(TEST_SCHEME, "100"),
        },
        query: {},
        body: { model: "gpt-4o" },
      });
      t.equal(requestResult.status, 200, "/request must succeed");
      t.equal(verifyCalls.length, 0, "pin=request: no authorize at /request");
      t.equal(
        settleCalls.length,
        1,
        "pin=request: capture fires once at /request",
      );
      t.equal(
        settleCalls[0]?.amount,
        "100",
        "pin=request captures the authorize amount, not the capture amount",
      );
      t.end();
    },
  );

  t.end();
});

await t.test(
  "openapi gateway: PaymentPolicy construction errors",
  async (t) => {
    await t.test(
      "pin capturesAt=response against settle-only handler fails at startup",
      (t) => {
        const spec = makeSpecWithPolicy({
          pin: { [`x402:${TEST_SCHEME}`]: { capturesAt: "response" } },
        });
        t.throws(
          () =>
            createGatewayHandler({
              spec,
              baseURL: BASE_URL,
              supportedVersions: { x402v1: false, x402v2: true },
              x402Handlers: [makeSettleOnlyX402Handler({ payTo: PAY_TO })],
            }),
          {
            message: new RegExp(
              `policy\\[${OP.replace(/[/]/g, "\\/")}\\]\\.pin\\["x402:${TEST_SCHEME}"\\]: capturesAt "response" requires a handler that implements handleVerify`,
            ),
          },
          "must throw with actionable message",
        );
        t.end();
      },
    );

    await t.test("unknown allow entry fails at startup", (t) => {
      const spec = makeSpecWithPolicy({ allow: ["x402:nonexistent"] });
      t.throws(
        () =>
          createGatewayHandler({
            spec,
            baseURL: BASE_URL,
            supportedVersions: { x402v1: false, x402v2: true },
            x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
          }),
        {
          message: new RegExp(
            `policy\\[${OP.replace(/[/]/g, "\\/")}\\]\\.allow: unknown entry "x402:nonexistent" \\(supported: x402:${TEST_SCHEME}\\)`,
          ),
        },
        "must throw with supported scheme list",
      );
      t.end();
    });

    await t.test("unknown pin key fails at startup", (t) => {
      const spec = makeSpecWithPolicy({
        pin: { "x402:nonexistent": { capturesAt: "request" } },
      });
      t.throws(
        () =>
          createGatewayHandler({
            spec,
            baseURL: BASE_URL,
            supportedVersions: { x402v1: false, x402v2: true },
            x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
          }),
        {
          message: new RegExp(
            `policy\\[${OP.replace(/[/]/g, "\\/")}\\]\\.pin: unknown entry "x402:nonexistent" \\(supported: x402:${TEST_SCHEME}\\)`,
          ),
        },
        "must throw with supported scheme list",
      );
      t.end();
    });

    await t.test("pin entry not in allow list fails at startup", (t) => {
      const spec = makeSpecWithPolicy({
        allow: [`x402:${TEST_SCHEME}`],
        pin: { "mpp:other": { capturesAt: "request" } },
      });
      t.throws(
        () =>
          createGatewayHandler({
            spec,
            baseURL: BASE_URL,
            supportedVersions: { x402v1: false, x402v2: true },
            x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
            mppMethodHandlers: [createTestMPPHandler({ method: "other" })],
          }),
        {
          message: new RegExp(
            `policy\\[${OP.replace(/[/]/g, "\\/")}\\]\\.pin\\["mpp:other"\\]: pinned entry is not in the allow list`,
          ),
        },
        "must throw when pin references disallowed scheme/method",
      );
      t.end();
    });

    await t.test("invalid pin capturesAt value rejected at parse", (t) => {
      // Parser-level (arktype) validation surfaces before construction.
      const doc = {
        paths: {
          "/test": {
            post: {
              "x-faremeter-pricing": {
                rules: [{ match: "$", capture: "100" }],
              },
              "x-faremeter-policy": {
                pin: { "x402:foo": { capturesAt: "sometime" } },
              },
            },
          },
        },
      };
      t.throws(
        () => extractSpec(doc),
        {
          message:
            /paths\["\/test"\]\.post x-faremeter-policy pin\["x402:foo"\]:/,
        },
        "invalid capturesAt rejected by parser",
      );
      t.end();
    });

    await t.test("MPP policy validates against registered MPP methods", (t) => {
      const spec = makeSpecWithPolicy({
        allow: [`mpp:${TEST_MPP_METHOD}`],
      });
      // No MPP handler registered -> mpp:test-solana is unknown.
      t.throws(
        () =>
          createGatewayHandler({
            spec,
            baseURL: BASE_URL,
            supportedVersions: { x402v1: false, x402v2: true },
            x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
          }),
        {
          message: new RegExp(
            `policy\\[${OP.replace(/[/]/g, "\\/")}\\]\\.allow: unknown entry "mpp:${TEST_MPP_METHOD}"`,
          ),
        },
        "must throw when allow references unregistered MPP method",
      );
      t.end();
    });

    t.end();
  },
);

await t.test(
  "openapi gateway: PaymentPolicy parser rejects misplaced extension",
  async (t) => {
    await t.test("x-faremeter-policy at document level rejected", (t) => {
      const doc = {
        "x-faremeter-policy": { allow: ["x402:exact"] },
        paths: {
          "/test": {
            post: {
              "x-faremeter-pricing": {
                rules: [{ match: "$", capture: "100" }],
              },
            },
          },
        },
      };
      t.throws(
        () => extractSpec(doc),
        {
          message:
            /document: x-faremeter-policy is only supported at the operation level/,
        },
        "document-level policy is rejected",
      );
      t.end();
    });

    await t.test("x-faremeter-policy at path level rejected", (t) => {
      const doc = {
        paths: {
          "/test": {
            "x-faremeter-policy": { allow: ["x402:exact"] },
            post: {
              "x-faremeter-pricing": {
                rules: [{ match: "$", capture: "100" }],
              },
            },
          },
        },
      };
      t.throws(
        () => extractSpec(doc),
        {
          message:
            /paths\["\/test"\]: x-faremeter-policy is only supported at the operation level/,
        },
        "path-level policy is rejected",
      );
      t.end();
    });

    await t.test(
      "x-faremeter-policy without x-faremeter-pricing rejected",
      (t) => {
        // An operation that declares a policy but no pricing rules
        // has nothing for the policy to gate. Previously the parser
        // silently dropped the policy along with the unpriced
        // operation; now the orphan is loud.
        const doc = {
          paths: {
            "/test": {
              post: {
                "x-faremeter-policy": { allow: ["x402:exact"] },
              },
            },
          },
        };
        t.throws(
          () => extractSpec(doc),
          {
            message:
              /paths\["\/test"\]\.post: x-faremeter-policy is declared but the operation has no x-faremeter-pricing rules/,
          },
          "orphan policy must be rejected at parse time",
        );
        t.end();
      },
    );

    t.end();
  },
);

await t.test(
  "openapi gateway: PaymentPolicy programmatic shape validation",
  async (t) => {
    // The OpenAPI parser's arktype validator catches malformed
    // `capturesAt` values in YAML/JSON specs. Programmatic callers
    // that construct a FaremeterSpec by hand bypass the parser, so
    // validateOperationPolicies has to backstop the shape check --
    // otherwise an unknown value silently flows through resolveCapturesAt
    // and demotes two-phase rules to one-phase.
    await t.test(
      "invalid pin capturesAt value rejected at createGatewayHandler",
      (t) => {
        const programmaticSpec: FaremeterSpec = {
          assets: TEST_SPEC_ASSETS,
          operations: {
            [OP]: {
              method: "POST",
              path: "/v1/chat/completions",
              transport: "json",
              rates: { test: 1n },
              rules: [{ match: "$", capture: "100" }],
              policy: {
                pin: {
                  [`x402:${TEST_SCHEME}`]: {
                    // Force-cast: simulate a programmatic caller that
                    // bypassed the parser's arktype validator and
                    // produced a malformed value.
                    capturesAt: "sometime" as "request" | "response",
                  },
                },
              },
            },
          },
        };
        t.throws(
          () =>
            createGatewayHandler({
              spec: programmaticSpec,
              baseURL: BASE_URL,
              supportedVersions: { x402v1: false, x402v2: true },
              x402Handlers: [createTestFacilitatorHandler({ payTo: PAY_TO })],
            }),
          {
            message: new RegExp(
              `policy\\[${OP.replace(/[/]/g, "\\/")}\\]\\.pin\\["x402:${TEST_SCHEME}"\\]\\.capturesAt: must be "request" or "response", got "sometime"`,
            ),
          },
          "unknown capturesAt value must throw at construction",
        );
        t.end();
      },
    );

    t.end();
  },
);

await t.test(
  "openapi gateway: MPP allow check at dispatch entry",
  async (t) => {
    // The 402 challenge hides disallowed methods, but a malicious or
    // stale client can still POST an Authorization: Payment header for
    // a disallowed method. The dispatch entry in handleMiddlewareRequest
    // must reject that credential and re-challenge, not honour it.
    //
    // Regression target: the empty-if-with-fall-through pattern at the
    // MPP credential check (see middleware/common.ts) is easy to break
    // during refactoring; this test pins the security guarantee.
    await t.test(
      "MPP credential for disallowed method falls through to 402",
      async (t) => {
        const OTHER_METHOD = "other-method";
        let testSettleCalls = 0;
        let testVerifyCalls = 0;
        const testMethodHandler = createTestMPPHandler({
          onSettle: () => {
            testSettleCalls++;
          },
          onVerify: () => {
            testVerifyCalls++;
          },
        });
        const otherMethodHandler = createTestMPPHandler({
          method: OTHER_METHOD,
        });

        const spec: FaremeterSpec = {
          assets: TEST_SPEC_ASSETS,
          operations: {
            [OP]: {
              method: "POST",
              path: "/v1/chat/completions",
              transport: "json",
              rates: { test: 1n },
              rules: [{ match: "$", capture: "100" }],
              policy: { allow: [`mpp:${OTHER_METHOD}`] },
            },
          },
        };

        const handler = createGatewayHandler({
          spec,
          baseURL: BASE_URL,
          mppMethodHandlers: [testMethodHandler, otherMethodHandler],
        });

        const challengeResult = await handler.handleRequest({
          operationKey: OP,
          method: "POST",
          path: "/v1/chat/completions",
          headers: {},
          query: {},
          body: {},
        });
        t.equal(challengeResult.status, 402, "first request returns 402");
        const wwwAuth = challengeResult.headers?.["WWW-Authenticate"];
        if (!wwwAuth) throw new Error("no WWW-Authenticate header");
        const challenges = parseWWWAuthenticate(wwwAuth);
        const allowedChallenge = challenges.find(
          (c) => c.method === OTHER_METHOD,
        );
        if (!allowedChallenge) throw new Error("no allowed challenge");
        t.notOk(
          challenges.some((c) => c.method === TEST_MPP_METHOD),
          "disallowed method must not appear in filtered 402 challenges",
        );

        // Forge a credential for the disallowed TEST_MPP_METHOD by
        // tampering with the allowed challenge before handing it to
        // the test client. The test client only matches challenges of
        // its own method, so we have to use the allowed method's
        // challenge as the carrier and rewrite the method field.
        const synthChallenge = {
          ...allowedChallenge,
          method: TEST_MPP_METHOD,
        };
        const clientHandler = createTestMPPPaymentHandler();
        const execer = await clientHandler(synthChallenge);
        if (!execer) {
          t.fail("client handler refused synthetic challenge");
          t.end();
          return;
        }
        const credential = await execer.exec();
        const authHeader = `Payment ${serializeCredential(credential)}`;

        const paymentResult = await handler.handleRequest({
          operationKey: OP,
          method: "POST",
          path: "/v1/chat/completions",
          headers: { Authorization: authHeader },
          query: {},
          body: {},
        });
        t.equal(
          paymentResult.status,
          402,
          "disallowed-method credential must produce 402, not settlement",
        );
        t.equal(testSettleCalls, 0, "disallowed method's settle must not fire");
        t.equal(testVerifyCalls, 0, "disallowed method's verify must not fire");

        t.end();
      },
    );

    t.end();
  },
);
