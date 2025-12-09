#!/usr/bin/env pnpm tsx

import t from "tap";
import { updateSplit } from "./updateSplit.js";
import { createMockRpc, createMockSigner, MOCK_MINT } from "./test-utils.js";

await t.test("updateSplit", async (t) => {
  await t.test("FAILED when RPC error occurs", async (t) => {
    const rpc = createMockRpc({
      getAccountInfo: async () => {
        throw new Error("RPC connection failed");
      },
    });
    const signer = createMockSigner();

    const result = await updateSplit(rpc, signer, {
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

  // Note: Testing NOT_FOUND, UPDATED, and BLOCKED requires
  // mocking the SDK functions that check split existence and state.

  t.end();
});
