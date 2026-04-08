#!/usr/bin/env pnpm tsx

import t from "tap";
import { createOWSSolanaWallet } from "./solana";
import type { OWSWalletOpts } from "./types";

const opts: OWSWalletOpts = {
  walletNameOrId: "test-wallet",
  passphrase: "test-pass",
};

await t.test("throws when no Solana account is found", async (t) => {
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      { chainId: "eip155:1", address: "0xabc", derivationPath: "m/44'/60'/0'" },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  t.throws(() => createOWSSolanaWallet("mainnet-beta", opts, fakeGetWallet), {
    message: /No Solana account found/,
  });
});

await t.test("returns wallet with correct shape and publicKey", async (t) => {
  const solanaAddress = "11111111111111111111111111111112";
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      {
        chainId: "solana:mainnet",
        address: solanaAddress,
        derivationPath: "m/44'/501'/0'",
      },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  const wallet = createOWSSolanaWallet("mainnet-beta", opts, fakeGetWallet);

  t.equal(wallet.network, "mainnet-beta");
  t.ok(wallet.publicKey, "publicKey is defined");
  t.equal(wallet.publicKey, solanaAddress);
  t.equal(typeof wallet.partiallySignTransaction, "function");
});
