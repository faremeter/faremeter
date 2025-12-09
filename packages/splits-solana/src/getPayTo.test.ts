#!/usr/bin/env pnpm tsx

import t from "tap";
import { getPayTo } from "./getPayTo.js";
import { MOCK_AUTHORITY, MOCK_MINT } from "./test-utils.js";

await t.test("getPayTo", async (t) => {
  await t.test("derives deterministic address for same inputs", async (t) => {
    const result1 = await getPayTo(MOCK_AUTHORITY, MOCK_MINT, "product-123");
    const result2 = await getPayTo(MOCK_AUTHORITY, MOCK_MINT, "product-123");

    t.equal(result1, result2, "same inputs produce same address");
    t.ok(result1.length > 30, "result looks like a valid address");
  });

  await t.test("different labels produce different addresses", async (t) => {
    const result1 = await getPayTo(MOCK_AUTHORITY, MOCK_MINT, "product-1");
    const result2 = await getPayTo(MOCK_AUTHORITY, MOCK_MINT, "product-2");

    t.not(result1, result2, "different labels produce different addresses");
  });

  await t.test(
    "different authorities produce different addresses",
    async (t) => {
      // Use a different valid base58 address (System Program)
      const authority2 =
        "11111111111111111111111111111111" as typeof MOCK_AUTHORITY;

      const result1 = await getPayTo(MOCK_AUTHORITY, MOCK_MINT, "same-label");
      const result2 = await getPayTo(authority2, MOCK_MINT, "same-label");

      t.not(
        result1,
        result2,
        "different authorities produce different addresses",
      );
    },
  );

  await t.test("different mints produce different addresses", async (t) => {
    // Use wrapped SOL mint as different mint
    const mint2 =
      "So11111111111111111111111111111111111111112" as typeof MOCK_MINT;

    const result1 = await getPayTo(MOCK_AUTHORITY, MOCK_MINT, "same-label");
    const result2 = await getPayTo(MOCK_AUTHORITY, mint2, "same-label");

    t.not(result1, result2, "different mints produce different addresses");
  });

  t.end();
});
