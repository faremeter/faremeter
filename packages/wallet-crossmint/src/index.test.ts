#!/usr/bin/env pnpm tsx

import t from "tap";

await t.test("@crossmint/wallets-sdk loads in Node", async (t) => {
  const sdk = await import("@crossmint/wallets-sdk");
  t.equal(typeof sdk.createCrossmint, "function");
  t.equal(typeof sdk.CrossmintWallets, "function");
  t.equal(typeof sdk.SolanaWallet, "function");
});

await t.test("createCrossmintWallet is exported", async (t) => {
  const mod = await import("./index");
  t.equal(typeof mod.createCrossmintWallet, "function");
});
