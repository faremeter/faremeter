#!/usr/bin/env pnpm tsx

import t from "tap";
import { ensureSplit } from "./ensureSplit.js";
import { createMockRpc, createMockSigner, MOCK_MINT } from "./test-utils.js";

await t.test("ensureSplit", async (t) => {
  await t.test("FAILED when RPC error occurs", async (t) => {
    // Create RPC that throws on getAccountInfo (used by detectTokenProgram)
    const rpc = createMockRpc({
      getAccountInfo: async () => {
        throw new Error("RPC connection failed");
      },
    });
    const signer = createMockSigner();

    const result = await ensureSplit(rpc, signer, {
      label: "test-split",
      mint: MOCK_MINT,
      recipients: [
        { address: "11111111111111111111111111111111", share: 50 },
        { address: "So11111111111111111111111111111111111111112", share: 50 },
      ],
    });

    t.equal(result.status, "FAILED");
    if (result.status === "FAILED") {
      t.match(result.message, /RPC connection failed/);
    }
  });

  // Note: Testing CREATED, NO_CHANGE, UPDATED, and BLOCKED requires
  // mocking the SDK functions that check split existence and state.
  // This would require either:
  // 1. Integration tests with a local validator
  // 2. Dependency injection for SDK functions
  // 3. Deep understanding of account data formats

  t.end();
});
