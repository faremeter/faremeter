#!/usr/bin/env pnpm tsx

import t from "tap";
import { createOWSEvmWallet } from "./evm";
import type { OWSWalletOpts } from "./types";

const chain = { id: 1, name: "Ethereum" };

const opts: OWSWalletOpts = {
  walletNameOrId: "test-wallet",
  passphrase: "test-pass",
};

await t.test("throws when no EVM account is found", async (t) => {
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      {
        chainId: "solana:mainnet",
        address: "11111111111111111111111111111112",
        derivationPath: "m/44'/501'/0'",
      },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  t.throws(() => createOWSEvmWallet(chain, opts, fakeGetWallet), {
    message: /No EVM account found/,
  });
});

await t.test("returns wallet with correct shape and address", async (t) => {
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      {
        chainId: "eip155:1",
        address: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
        derivationPath: "m/44'/60'/0'",
      },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  const wallet = createOWSEvmWallet(chain, opts, fakeGetWallet);

  t.same(wallet.chain, chain);
  t.ok(wallet.address.startsWith("0x"), "address is 0x-prefixed");
  t.equal(
    wallet.address,
    wallet.address.toLowerCase(),
    "address is lowercased",
  );
  t.equal(wallet.address, "0xabcdef0123456789abcdef0123456789abcdef01");
  t.equal(typeof wallet.account.signTypedData, "function");
});

await t.test("adds 0x prefix when address lacks one", async (t) => {
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      {
        chainId: "eip155:1",
        address: "AbCdEf0123456789AbCdEf0123456789AbCdEf01",
        derivationPath: "m/44'/60'/0'",
      },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  const wallet = createOWSEvmWallet(chain, opts, fakeGetWallet);

  t.ok(wallet.address.startsWith("0x"), "address gets 0x prefix");
  t.equal(wallet.address, "0xabcdef0123456789abcdef0123456789abcdef01");
});

await t.test("throws for a non-hex address", async (t) => {
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      {
        chainId: "eip155:1",
        address: "not-a-real-address",
        derivationPath: "m/44'/60'/0'",
      },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  t.throws(() => createOWSEvmWallet(chain, opts, fakeGetWallet), {
    message: /Invalid EVM address/,
  });
});

await t.test("throws for a too-short address", async (t) => {
  const fakeGetWallet = () => ({
    id: "w1",
    name: "test-wallet",
    accounts: [
      {
        chainId: "eip155:1",
        address: "0xabcd",
        derivationPath: "m/44'/60'/0'",
      },
    ],
    createdAt: "2025-01-01T00:00:00Z",
  });

  t.throws(() => createOWSEvmWallet(chain, opts, fakeGetWallet), {
    message: /Invalid EVM address/,
  });
});
