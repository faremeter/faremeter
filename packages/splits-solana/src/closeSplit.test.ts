#!/usr/bin/env pnpm tsx

import t from "tap";
import { closeSplit } from "./closeSplit.js";
import { createMockRpc, createMockSigner, MOCK_MINT } from "./test-utils.js";

await t.test("closeSplit", async (t) => {
  await t.test("FAILED when RPC error occurs", async (t) => {
    const rpc = createMockRpc({
      getAccountInfo: async () => {
        throw new Error("RPC connection failed");
      },
    });
    const signer = createMockSigner();

    const result = await closeSplit(rpc, signer, {
      label: "test-split",
      mint: MOCK_MINT,
    });

    t.equal(result.status, "FAILED");
    if (result.status === "FAILED") {
      t.match(result.message, /RPC connection failed/);
    }
  });

  // Note: Testing NOT_FOUND, CLOSED, and BLOCKED requires
  // mocking the SDK functions that check split existence and state.

  t.end();
});
