#!/usr/bin/env pnpm tsx

import t from "tap";
import type { FacilitatorHandler } from "./facilitator";
import type { ResourcePricing } from "./pricing";
import {
  narrowHandlers,
  resolveX402Requirements,
  settleX402Payment,
  verifyX402Payment,
} from "./x402-handlers";

function mockHandler(
  overrides?: Omit<Partial<FacilitatorHandler>, "capabilities"> & {
    capabilities?: FacilitatorHandler["capabilities"] | null;
  },
): FacilitatorHandler {
  const { capabilities = undefined, ...rest } = overrides ?? {};
  const base: FacilitatorHandler = {
    getRequirements: async ({ accepts }) => accepts,
    handleSettle: async () => ({
      success: true,
      transaction: "tx-1",
      network: "solana:devnet",
      payer: "payer-1",
    }),
    ...rest,
  };

  if (capabilities === null) {
    return base;
  }

  base.capabilities = capabilities ?? {
    schemes: ["exact"],
    networks: ["solana:devnet"],
    assets: ["USDC"],
  };

  return base;
}

const pricing: ResourcePricing[] = [
  {
    amount: "100",
    asset: "USDC",
    recipient: "recv-1",
    network: "solana:devnet",
  },
];

await t.test("narrowHandlers filters by network and asset", async (t) => {
  const matching = mockHandler();
  const noNetwork = mockHandler({
    capabilities: {
      schemes: ["exact"],
      networks: ["eip155:1"],
      assets: ["USDC"],
    },
  });
  const noAsset = mockHandler({
    capabilities: {
      schemes: ["exact"],
      networks: ["solana:devnet"],
      assets: ["SOL"],
    },
  });
  const noCaps = mockHandler({ capabilities: null });

  const result = narrowHandlers([matching, noNetwork, noAsset, noCaps], {
    network: "solana:devnet",
    asset: "USDC",
  });

  t.equal(result.length, 1);
  t.equal(result[0], matching);
  t.end();
});

await t.test("narrowHandlers matches case-insensitively", async (t) => {
  const handler = mockHandler({
    capabilities: {
      schemes: ["exact"],
      networks: ["Solana:Devnet"],
      assets: ["usdc"],
    },
  });

  const result = narrowHandlers([handler], {
    network: "solana:devnet",
    asset: "USDC",
  });

  t.equal(result.length, 1);
  t.end();
});

await t.test(
  "resolveX402Requirements constructs accepts from pricing and schemes",
  async (t) => {
    let capturedAccepts: unknown[] = [];
    const handler = mockHandler({
      getRequirements: async ({ accepts }) => {
        capturedAccepts = accepts;
        return accepts;
      },
    });

    const result = await resolveX402Requirements(
      [handler],
      pricing,
      "https://example.com/resource",
    );

    t.equal(result.length, 1);
    t.equal(capturedAccepts.length, 1);

    const req = result[0];
    if (!req) {
      t.fail("expected a requirement");
      t.end();
      return;
    }
    t.equal(req.scheme, "exact");
    t.equal(req.network, "solana:devnet");
    t.equal(req.amount, "100");
    t.equal(req.asset, "USDC");
    t.equal(req.payTo, "recv-1");
    t.equal(req.maxTimeoutSeconds, 0);
    t.end();
  },
);

await t.test(
  "resolveX402Requirements produces cross-product of schemes and pricing",
  async (t) => {
    const handler = mockHandler({
      capabilities: {
        schemes: ["exact", "flex"],
        networks: ["solana:devnet"],
        assets: ["USDC"],
      },
      getRequirements: async ({ accepts }) => accepts,
    });

    const result = await resolveX402Requirements(
      [handler],
      pricing,
      "https://example.com",
    );

    t.equal(result.length, 2);
    t.equal(result[0]?.scheme, "exact");
    t.equal(result[1]?.scheme, "flex");
    t.end();
  },
);

await t.test(
  "resolveX402Requirements skips handlers without capabilities",
  async (t) => {
    const noCaps = mockHandler({ capabilities: null });
    const withCaps = mockHandler();

    const result = await resolveX402Requirements(
      [noCaps, withCaps],
      pricing,
      "https://example.com",
    );

    t.equal(result.length, 1);
    t.end();
  },
);

await t.test("resolveX402Requirements propagates handler throws", async (t) => {
  const throwing = mockHandler({
    getRequirements: async () => {
      throw new Error("boom");
    },
  });

  await t.rejects(
    resolveX402Requirements([throwing], pricing, "https://example.com"),
    { message: "boom" },
  );
  t.end();
});

await t.test(
  "resolveX402Requirements skips unmatched pricing entries",
  async (t) => {
    const handler = mockHandler({
      capabilities: {
        schemes: ["exact"],
        networks: ["eip155:1"],
        assets: ["USDC"],
      },
    });

    const result = await resolveX402Requirements(
      [handler],
      pricing,
      "https://example.com",
    );

    t.equal(result.length, 0);
    t.end();
  },
);

await t.test("settleX402Payment returns first non-null result", async (t) => {
  const rejects = mockHandler({
    handleSettle: async () => null,
  });
  const accepts = mockHandler({
    handleSettle: async () => ({
      success: true,
      transaction: "tx-2",
      network: "solana:devnet",
      payer: "payer-2",
    }),
  });

  const requirements = {
    scheme: "exact",
    network: "solana:devnet",
    amount: "100",
    asset: "USDC",
    payTo: "recv-1",
    maxTimeoutSeconds: 30,
  };
  const payment = {
    x402Version: 2 as const,
    accepted: requirements,
    payload: { testId: "1", amount: "100", timestamp: 1 },
  };

  const result = await settleX402Payment(
    [rejects, accepts],
    requirements,
    payment,
  );

  t.equal(result.transaction, "tx-2");
  t.end();
});

await t.test("settleX402Payment throws when no handler accepts", async (t) => {
  const rejects = mockHandler({
    handleSettle: async () => null,
  });

  const requirements = {
    scheme: "exact",
    network: "solana:devnet",
    amount: "100",
    asset: "USDC",
    payTo: "recv-1",
    maxTimeoutSeconds: 30,
  };
  const payment = {
    x402Version: 2 as const,
    accepted: requirements,
    payload: {},
  };

  await t.rejects(settleX402Payment([rejects], requirements, payment), {
    message: /no handler accepted the settlement/,
  });
  t.end();
});

await t.test("settleX402Payment propagates handler throws", async (t) => {
  const throwing = mockHandler({
    handleSettle: async () => {
      throw new Error("settle boom");
    },
  });

  const requirements = {
    scheme: "exact",
    network: "solana:devnet",
    amount: "100",
    asset: "USDC",
    payTo: "recv-1",
    maxTimeoutSeconds: 30,
  };
  const payment = {
    x402Version: 2 as const,
    accepted: requirements,
    payload: {},
  };

  await t.rejects(settleX402Payment([throwing], requirements, payment), {
    message: "settle boom",
  });
  t.end();
});

await t.test(
  "verifyX402Payment skips handlers without handleVerify",
  async (t) => {
    const noVerify = mockHandler();
    delete noVerify.handleVerify;

    const withVerify = mockHandler({
      handleVerify: async () => ({ isValid: true, payer: "payer-1" }),
    });

    const requirements = {
      scheme: "exact",
      network: "solana:devnet",
      amount: "100",
      asset: "USDC",
      payTo: "recv-1",
      maxTimeoutSeconds: 30,
    };
    const payment = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: {},
    };

    const result = await verifyX402Payment(
      [noVerify, withVerify],
      requirements,
      payment,
    );

    t.equal(result.isValid, true);
    t.end();
  },
);

await t.test(
  "verifyX402Payment throws when all handlers return null",
  async (t) => {
    const rejects = mockHandler({
      handleVerify: async () => null,
    });

    const requirements = {
      scheme: "exact",
      network: "solana:devnet",
      amount: "100",
      asset: "USDC",
      payTo: "recv-1",
      maxTimeoutSeconds: 30,
    };
    const payment = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: {},
    };

    await t.rejects(verifyX402Payment([rejects], requirements, payment), {
      message: /no handler accepted the verification/,
    });
    t.end();
  },
);

await t.test("verifyX402Payment propagates handler throws", async (t) => {
  const throwing = mockHandler({
    handleVerify: async () => {
      throw new Error("verify boom");
    },
  });

  const requirements = {
    scheme: "exact",
    network: "solana:devnet",
    amount: "100",
    asset: "USDC",
    payTo: "recv-1",
    maxTimeoutSeconds: 30,
  };
  const payment = {
    x402Version: 2 as const,
    accepted: requirements,
    payload: {},
  };

  await t.rejects(verifyX402Payment([throwing], requirements, payment), {
    message: "verify boom",
  });
  t.end();
});
