#!/usr/bin/env pnpm tsx

import t from "tap";
import { AccountRole, address } from "@solana/kit";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { toTransactionInstruction, createPaymentHandler } from "./client";
import type { x402PaymentRequirements } from "@faremeter/types/x402v2";

await t.test("toTransactionInstruction", async (t) => {
  const programAddr = address("11111111111111111111111111111111");
  const accountAddr = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  await t.test("maps all AccountRole values correctly", async (t) => {
    const roles = [
      {
        role: AccountRole.READONLY,
        expectedSigner: false,
        expectedWritable: false,
      },
      {
        role: AccountRole.WRITABLE,
        expectedSigner: false,
        expectedWritable: true,
      },
      {
        role: AccountRole.READONLY_SIGNER,
        expectedSigner: true,
        expectedWritable: false,
      },
      {
        role: AccountRole.WRITABLE_SIGNER,
        expectedSigner: true,
        expectedWritable: true,
      },
    ] as const;

    for (const { role, expectedSigner, expectedWritable } of roles) {
      const result = toTransactionInstruction({
        programAddress: programAddr,
        accounts: [{ address: accountAddr, role }],
        data: new Uint8Array([1, 2, 3]),
      });

      t.equal(result.programId.toBase58(), programAddr);
      t.equal(result.keys.length, 1);
      t.equal(
        result.keys[0]?.isSigner,
        expectedSigner,
        `role ${role}: isSigner should be ${expectedSigner}`,
      );
      t.equal(
        result.keys[0]?.isWritable,
        expectedWritable,
        `role ${role}: isWritable should be ${expectedWritable}`,
      );
    }

    t.pass();
    t.end();
  });

  await t.test("handles instruction with data", async (t) => {
    const result = toTransactionInstruction({
      programAddress: programAddr,
      accounts: [],
      data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });

    t.equal(result.data.length, 4);
    t.same([...result.data], [0xde, 0xad, 0xbe, 0xef]);

    t.pass();
    t.end();
  });

  await t.test("handles instruction without data", async (t) => {
    const result = toTransactionInstruction({
      programAddress: programAddr,
      accounts: [],
    });

    t.equal(result.data.length, 0);

    t.pass();
    t.end();
  });

  await t.test("handles instruction without accounts", async (t) => {
    const result = toTransactionInstruction({
      programAddress: programAddr,
      data: new Uint8Array([1]),
    });

    t.equal(result.keys.length, 0);

    t.pass();
    t.end();
  });
});

await t.test("createPaymentHandler", async (t) => {
  const keypair = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const receiver = Keypair.generate().publicKey;
  const feePayer = Keypair.generate().publicKey;

  const wallet = {
    network: "devnet",
    publicKey: keypair.publicKey,
    partiallySignTransaction: async (tx: VersionedTransaction) => tx,
  };

  const requirements: x402PaymentRequirements = {
    scheme: "exact",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    amount: "1000000",
    asset: mint.toBase58(),
    payTo: receiver.toBase58(),
    maxTimeoutSeconds: 30,
    extra: {
      feePayer: feePayer.toBase58(),
      decimals: 6,
      recentBlockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3",
    },
  };

  await t.test("returns a function", async (t) => {
    const handler = createPaymentHandler(wallet, mint);
    t.equal(typeof handler, "function");
    t.end();
  });

  await t.test("returns PaymentExecer for matching requirements", async (t) => {
    const handler = createPaymentHandler(wallet, mint);
    const context = { request: new Request("https://example.com") };
    const execers = await handler(context, [requirements]);

    t.equal(execers.length, 1);
    t.ok(execers[0]?.exec);
    t.equal(typeof execers[0]?.exec, "function");
    t.same(execers[0]?.requirements, requirements);
    t.end();
  });

  await t.test("exec produces a payload with a transaction", async (t) => {
    const handler = createPaymentHandler(wallet, mint);
    const context = { request: new Request("https://example.com") };
    const execers = await handler(context, [requirements]);
    const execer = execers[0];
    if (!execer) throw new Error("expected an execer");
    const result = await execer.exec();

    t.ok(result.payload);
    t.ok(
      "transaction" in result.payload,
      "payload should contain a transaction",
    );
    t.equal(
      typeof (result.payload as { transaction: string }).transaction,
      "string",
    );
    t.end();
  });

  await t.test("skips non-matching requirements", async (t) => {
    const handler = createPaymentHandler(wallet, mint);
    const context = { request: new Request("https://example.com") };
    const wrongNetwork = {
      ...requirements,
      network: "solana:SomeOtherNetwork",
    };
    const execers = await handler(context, [wrongNetwork]);

    t.equal(execers.length, 0);
    t.end();
  });

  await t.test("deprecated Connection overload works", async (t) => {
    const fakeConnection = { rpcEndpoint: "https://api.devnet.solana.com" };
    const handler = createPaymentHandler(wallet, mint, fakeConnection);
    t.equal(typeof handler, "function");
    t.end();
  });
});
