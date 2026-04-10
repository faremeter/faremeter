#!/usr/bin/env pnpm tsx

import t from "tap";
import { address, createKeyPairSignerFromBytes } from "@solana/kit";
import { toAddress, toKeyPairSigner } from "./compat";

// A deterministic 64-byte secret key for testing (32-byte seed +
// 32-byte public key, as expected by createKeyPairSignerFromBytes).
// Generated once from a known seed; the address is deterministic.
const TEST_SECRET_KEY = new Uint8Array([
  174, 47, 154, 16, 202, 193, 206, 113, 199, 190, 53, 133, 169, 175, 31, 56,
  222, 53, 138, 189, 224, 216, 117, 173, 10, 149, 53, 45, 73, 251, 237, 246, 15,
  185, 186, 82, 177, 240, 148, 69, 241, 227, 167, 80, 141, 89, 240, 121, 121,
  35, 172, 247, 68, 251, 226, 218, 48, 63, 176, 109, 168, 89, 238, 135,
]);

// ---------- toAddress ----------

await t.test("toAddress: passes through a kit Address string", async (t) => {
  const addr = address("11111111111111111111111111111111");
  const result = toAddress(addr);
  t.equal(result, addr);
});

await t.test("toAddress: converts a PublicKey-like object", async (t) => {
  const fakePublicKey = {
    toBase58: () => "11111111111111111111111111111111",
  };
  const result = toAddress(fakePublicKey);
  t.equal(result, "11111111111111111111111111111111");
});

await t.test("toAddress: throws on invalid input", async (t) => {
  t.throws(() => toAddress(42 as never), {
    message: /expected an Address string or PublicKey/,
  });
});

// ---------- toKeyPairSigner ----------

await t.test(
  "toKeyPairSigner: passes through a kit KeyPairSigner",
  async (t) => {
    const signer = await createKeyPairSignerFromBytes(TEST_SECRET_KEY);
    const result = await toKeyPairSigner(signer);
    t.equal(result.address, signer.address);
    t.ok("signMessages" in result);
  },
);

await t.test("toKeyPairSigner: converts a Uint8Array secret key", async (t) => {
  const expected = await createKeyPairSignerFromBytes(TEST_SECRET_KEY);
  const result = await toKeyPairSigner(TEST_SECRET_KEY);
  t.equal(result.address, expected.address);
  t.ok("signMessages" in result);
});

await t.test("toKeyPairSigner: converts a Keypair-like object", async (t) => {
  const expected = await createKeyPairSignerFromBytes(TEST_SECRET_KEY);

  // Duck-type that matches @solana/web3.js v1 Keypair shape
  const fakeKeypair = {
    secretKey: TEST_SECRET_KEY,
    publicKey: { toBase58: () => expected.address },
  };

  const result = await toKeyPairSigner(fakeKeypair);
  t.equal(result.address, expected.address);
  t.ok("signMessages" in result);
});

await t.test("toKeyPairSigner: throws on invalid input", async (t) => {
  await t.rejects(() => toKeyPairSigner("not-a-signer" as never), {
    message: /expected a Uint8Array, KeyPairSigner, or Keypair/,
  });
});
