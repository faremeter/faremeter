#!/usr/bin/env pnpm tsx

import t from "tap";
import type { MPPMethodHandler } from "./handler";
import { settleMPPPayment, verifyMPPPayment } from "./handler";
import type { mppCredential, mppReceipt } from "./types";

function makeCredential(method: string): mppCredential {
  return {
    challenge: {
      id: "test-id",
      realm: "test-realm",
      method,
      intent: "charge",
      request: btoa(JSON.stringify({ amount: "100", currency: "USD" })),
    },
    payload: { type: "transaction", transaction: "dGVzdA" },
  };
}

function makeReceipt(method: string, ref: string): mppReceipt {
  return {
    status: "success",
    method,
    timestamp: new Date().toISOString(),
    reference: ref,
  };
}

function makeHandler(
  method: string,
  opts?: {
    settleResult?: mppReceipt | null;
    verifyResult?: mppReceipt | null;
    hasVerify?: boolean;
  },
): MPPMethodHandler {
  const handler: MPPMethodHandler = {
    method,
    capabilities: { networks: [], assets: [] },
    getSupportedIntents: () => ["charge"],
    getChallenge: async () => ({
      id: "c",
      realm: "r",
      method,
      intent: "charge",
      request: "req",
    }),
    handleSettle: async () => opts?.settleResult ?? null,
  };
  if (opts?.hasVerify !== false) {
    handler.handleVerify = async () => opts?.verifyResult ?? null;
  }
  return handler;
}

await t.test("settleMPPPayment", async (t) => {
  await t.test("routes to matching handler and returns receipt", async (t) => {
    const receipt = makeReceipt("solana", "tx-1");
    const handler = makeHandler("solana", { settleResult: receipt });
    const result = await settleMPPPayment([handler], makeCredential("solana"));
    t.matchOnly(result, receipt);
    t.end();
  });

  await t.test(
    "throws when no handler matches the credential method",
    async (t) => {
      const handler = makeHandler("ethereum", {
        settleResult: makeReceipt("ethereum", "tx-1"),
      });
      await t.rejects(settleMPPPayment([handler], makeCredential("solana")), {
        message: 'no MPP handler accepted settlement for method "solana"',
      });
      t.end();
    },
  );

  await t.test("throws when all matching handlers return null", async (t) => {
    const h1 = makeHandler("solana", { settleResult: null });
    const h2 = makeHandler("solana", { settleResult: null });
    await t.rejects(settleMPPPayment([h1, h2], makeCredential("solana")), {
      message: 'no MPP handler accepted settlement for method "solana"',
    });
    t.end();
  });

  await t.test("throws when handler list is empty", async (t) => {
    await t.rejects(settleMPPPayment([], makeCredential("solana")), {
      message: 'no MPP handler accepted settlement for method "solana"',
    });
    t.end();
  });

  await t.test(
    "returns first non-null result from multiple candidates",
    async (t) => {
      const expected = makeReceipt("solana", "tx-second");
      const h1 = makeHandler("solana", { settleResult: null });
      const h2 = makeHandler("solana", { settleResult: expected });
      const result = await settleMPPPayment([h1, h2], makeCredential("solana"));
      t.matchOnly(result, expected);
      t.end();
    },
  );

  t.end();
});

await t.test("verifyMPPPayment", async (t) => {
  await t.test("routes to matching handler and returns receipt", async (t) => {
    const receipt = makeReceipt("solana", "verify-1");
    const handler = makeHandler("solana", { verifyResult: receipt });
    const result = await verifyMPPPayment([handler], makeCredential("solana"));
    t.matchOnly(result, receipt);
    t.end();
  });

  await t.test(
    "throws when no handler supports verification for the method",
    async (t) => {
      const handler = makeHandler("solana", { hasVerify: false });
      await t.rejects(verifyMPPPayment([handler], makeCredential("solana")), {
        message: 'no MPP handler supports verification for method "solana"',
      });
      t.end();
    },
  );

  await t.test(
    "throws when verify-capable handler exists for a different method",
    async (t) => {
      const handler = makeHandler("ethereum", {
        verifyResult: makeReceipt("ethereum", "verify-1"),
      });
      await t.rejects(verifyMPPPayment([handler], makeCredential("solana")), {
        message: 'no MPP handler supports verification for method "solana"',
      });
      t.end();
    },
  );

  await t.test(
    "throws when all verify-capable handlers return null",
    async (t) => {
      const h1 = makeHandler("solana", { verifyResult: null });
      const h2 = makeHandler("solana", { verifyResult: null });
      await t.rejects(verifyMPPPayment([h1, h2], makeCredential("solana")), {
        message: 'no MPP handler accepted verification for method "solana"',
      });
      t.end();
    },
  );

  await t.test("throws when handler list is empty", async (t) => {
    await t.rejects(verifyMPPPayment([], makeCredential("solana")), {
      message: 'no MPP handler supports verification for method "solana"',
    });
    t.end();
  });

  await t.test(
    "skips handlers without handleVerify even if method matches",
    async (t) => {
      const noVerify = makeHandler("solana", { hasVerify: false });
      const withVerify = makeHandler("solana", {
        verifyResult: makeReceipt("solana", "verify-2"),
      });
      const result = await verifyMPPPayment(
        [noVerify, withVerify],
        makeCredential("solana"),
      );
      t.equal(result.reference, "verify-2");
      t.end();
    },
  );

  await t.test(
    "returns first non-null result from multiple candidates",
    async (t) => {
      const expected = makeReceipt("solana", "verify-second");
      const h1 = makeHandler("solana", { verifyResult: null });
      const h2 = makeHandler("solana", { verifyResult: expected });
      const result = await verifyMPPPayment([h1, h2], makeCredential("solana"));
      t.matchOnly(result, expected);
      t.end();
    },
  );

  t.end();
});
