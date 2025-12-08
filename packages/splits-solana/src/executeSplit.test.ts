#!/usr/bin/env pnpm tsx

import t from "tap";
import { executeSplit } from "./executeSplit.js";
import { createMockRpc, createMockSigner, MOCK_VAULT } from "./test-utils.js";

await t.test("executeSplit", async (t) => {
  await t.test(
    "SKIPPED: NOT_A_SPLIT when address is not a cascade split",
    async (t) => {
      // When getAccountInfo returns null, isCascadeSplit returns false
      const rpc = createMockRpc({
        getAccountInfo: async () => ({ value: null }),
      });
      const signer = createMockSigner();

      const result = await executeSplit(rpc, signer, { vault: MOCK_VAULT });

      t.equal(result.status, "SKIPPED");
      if (result.status === "SKIPPED") {
        t.equal(result.reason, "NOT_A_SPLIT");
      }
    },
  );

  // Note: Testing EMPTY_VAULT, BELOW_THRESHOLD, and EXECUTED requires
  // mocking isCascadeSplit to return true, which requires understanding
  // the account data format expected by the SDK.
  //
  // For now, we test the NOT_A_SPLIT case which is the simplest.
  // More comprehensive tests would require either:
  // 1. Integration tests with a real validator
  // 2. Mocking the SDK functions via dependency injection
  // 3. Understanding the exact account data format

  t.end();
});
