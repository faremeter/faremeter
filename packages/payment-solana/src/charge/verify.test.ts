#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import {
  getTransferSolInstruction,
  TRANSFER_SOL_DISCRIMINATOR,
} from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstruction,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  TRANSFER_CHECKED_DISCRIMINATOR,
} from "@solana-program/token";
import {
  appendTransactionMessageInstructions,
  AccountRole,
  address,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import type { Blockhash } from "@solana/rpc-types";

import type { mppChargeRequest } from "./common";
import {
  verifyChargeTransaction,
  verifyNativeChargeTransaction,
} from "./verify";
import type { CompilableTransactionMessage } from "../common";

const FAKE_BLOCKHASH =
  "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;
const OVERSIZED_MEMO = "x".repeat(567);

function buildTxMessage(
  instructions: Instruction[],
  feePayer: KeyPairSigner,
): CompilableTransactionMessage {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(feePayer.address, msg),
    (msg) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1000n },
        msg,
      ),
    (msg) => appendTransactionMessageInstructions(instructions, msg),
  );
}

function withNonTransferSolDiscriminator(ix: Instruction): Instruction {
  if (!ix.data) {
    throw new Error("expected instruction data");
  }
  const data = new Uint8Array(ix.data);
  data[0] = TRANSFER_SOL_DISCRIMINATOR + 1;
  return { ...ix, data };
}

function withNonTransferCheckedDiscriminator(ix: Instruction): Instruction {
  if (!ix.data) {
    throw new Error("expected instruction data");
  }
  const data = new Uint8Array(ix.data);
  data[0] = TRANSFER_CHECKED_DISCRIMINATOR + 1;
  return { ...ix, data };
}

function withLeadingBOM(ix: Instruction): Instruction {
  if (!ix.data) {
    throw new Error("expected instruction data");
  }
  const data = new Uint8Array(ix.data);
  return { ...ix, data: Uint8Array.of(0xef, 0xbb, 0xbf, ...data) };
}

async function createTokenFixtures(memo = "challenge-a") {
  const sender = await generateKeyPairSigner();
  const receiver = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  const amount = 1_000_000n;
  const decimals = 6;

  const [senderATA] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: sender.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [receiverATA] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: receiver.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const request: mppChargeRequest = {
    amount: amount.toString(),
    currency: mint.address,
    recipient: receiver.address,
    externalId: memo,
    methodDetails: {
      decimals,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
  };

  const transferIx = getTransferCheckedInstruction(
    {
      source: senderATA,
      mint: mint.address,
      destination: receiverATA,
      authority: sender.address,
      amount,
      decimals,
    },
    { programAddress: TOKEN_PROGRAM_ADDRESS },
  );

  return {
    sender,
    request,
    transferIx,
    computeLimitIx: getSetComputeUnitLimitInstruction({ units: 50_000 }),
    computePriceIx: getSetComputeUnitPriceInstruction({ microLamports: 1n }),
  };
}

type TokenFixtures = Awaited<ReturnType<typeof createTokenFixtures>>;

async function createTokenTransferIx(
  f: TokenFixtures,
  recipient: string,
  amount: bigint,
  sender = f.sender.address,
): Promise<Instruction> {
  const decimals = f.request.methodDetails?.decimals;
  if (decimals === undefined) {
    throw new Error("expected token decimals");
  }

  const [sourceATA] = await findAssociatedTokenPda({
    mint: address(f.request.currency),
    owner: address(sender),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [receiverATA] = await findAssociatedTokenPda({
    mint: address(f.request.currency),
    owner: address(recipient),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  return getTransferCheckedInstruction(
    {
      source: sourceATA,
      mint: address(f.request.currency),
      destination: receiverATA,
      authority: address(sender),
      amount,
      decimals,
    },
    { programAddress: TOKEN_PROGRAM_ADDRESS },
  );
}

async function createNativeFixtures(memo = "challenge-a") {
  const sender = await generateKeyPairSigner();
  const receiver = await generateKeyPairSigner();
  const amount = 1_000_000n;

  const request: mppChargeRequest = {
    amount: amount.toString(),
    currency: "sol",
    recipient: receiver.address,
    externalId: memo,
    methodDetails: {
      decimals: 9,
    },
  };

  const transferIx = getTransferSolInstruction({
    source: createNoopSigner(sender.address),
    destination: receiver.address,
    amount,
  });

  return {
    sender,
    request,
    transferIx,
    computeLimitIx: getSetComputeUnitLimitInstruction({ units: 50_000 }),
    computePriceIx: getSetComputeUnitPriceInstruction({ microLamports: 1n }),
  };
}

await t.test("verifyChargeTransaction validates challenge memo", async (t) => {
  await t.test("accepts matching memo", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { payer: f.sender.address });
    t.end();
  });

  await t.test("rejects missing memo", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "expected a Memo instruction" });
    t.end();
  });

  await t.test("rejects memo instruction accounts", async (t) => {
    const f = await createTokenFixtures();
    const memoIx: Instruction = {
      ...getAddMemoInstruction({ memo: "challenge-a" }),
      accounts: [
        {
          address: f.sender.address,
          role: AccountRole.WRITABLE_SIGNER,
        },
      ],
    };
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx, memoIx],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "Memo instruction must not include accounts",
    });
    t.end();
  });

  await t.test("rejects empty memo", async (t) => {
    const f = await createTokenFixtures("");
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "unexpected Memo instruction" });
    t.end();
  });

  await t.test("accepts missing challenge memo", async (t) => {
    const f = await createTokenFixtures();
    const request: mppChargeRequest = {
      amount: f.request.amount,
      currency: f.request.currency,
      recipient: f.request.recipient,
      ...(f.request.methodDetails
        ? { methodDetails: f.request.methodDetails }
        : {}),
    };
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { payer: f.sender.address });
    t.end();
  });

  await t.test("rejects mismatched memo", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "wrong-challenge" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "Memo instruction data does not match challenge",
    });
    t.end();
  });

  await t.test("rejects BOM-prefixed memo", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        withLeadingBOM(getAddMemoInstruction({ memo: "challenge-a" })),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "Memo instruction data does not match challenge",
    });
    t.end();
  });

  await t.test("rejects oversized challenge memo", async (t) => {
    const f = await createTokenFixtures(OVERSIZED_MEMO);
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: OVERSIZED_MEMO }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "Memo exceeds 566 bytes" });
    t.end();
  });

  await t.test("rejects fake token program transferChecked", async (t) => {
    const f = await createTokenFixtures();
    const fakeProgram = await generateKeyPairSigner();
    const fakeIx: Instruction = {
      ...f.transferIx,
      programAddress: fakeProgram.address,
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        fakeIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "no matching transferChecked instruction found",
    });
    t.end();
  });

  await t.test("rejects non-transferChecked token instruction", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        withNonTransferCheckedDiscriminator(f.transferIx),
        getAddMemoInstruction({ memo: "challenge-a" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "no matching transferChecked instruction found",
    });
    t.end();
  });

  await t.test("rejects additional duplicate challenge memo", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
        getAddMemoInstruction({ memo: "challenge-a" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "unexpected Memo instruction" });
    t.end();
  });

  await t.test("rejects additional non-challenge memo", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
        getAddMemoInstruction({ memo: "split-memo" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "unexpected Memo instruction" });
    t.end();
  });

  await t.test("accepts split memo matching externalId", async (t) => {
    const f = await createTokenFixtures("shared-memo");
    const splitReceiver = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        splits: [
          {
            amount: "250000",
            memo: "shared-memo",
            recipient: splitReceiver.address,
          },
        ],
      },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        await createTokenTransferIx(f, f.request.recipient, 750000n),
        getAddMemoInstruction({ memo: "shared-memo" }),
        await createTokenTransferIx(f, splitReceiver.address, 250000n),
        getAddMemoInstruction({ memo: "shared-memo" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { payer: f.sender.address });
    t.end();
  });

  await t.test("rejects oversized split memo", async (t) => {
    const f = await createTokenFixtures();
    const splitReceiver = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        splits: [
          {
            amount: "250000",
            memo: OVERSIZED_MEMO,
            recipient: splitReceiver.address,
          },
        ],
      },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        await createTokenTransferIx(f, f.request.recipient, 750000n),
        getAddMemoInstruction({ memo: "challenge-a" }),
        await createTokenTransferIx(f, splitReceiver.address, 250000n),
        getAddMemoInstruction({ memo: OVERSIZED_MEMO }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "Memo exceeds 566 bytes" });
    t.end();
  });

  await t.test(
    "accepts fee payer split ATA creation instruction",
    async (t) => {
      const f = await createTokenFixtures();
      const feePayer = await generateKeyPairSigner();
      const splitReceiver = await generateKeyPairSigner();
      const [splitATA] = await findAssociatedTokenPda({
        mint: address(f.request.currency),
        owner: splitReceiver.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          feePayer: true,
          feePayerKey: feePayer.address,
          splits: [
            {
              amount: "250000",
              ataCreationRequired: true,
              memo: "split-memo",
              recipient: splitReceiver.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          await createTokenTransferIx(f, f.request.recipient, 750000n),
          getAddMemoInstruction({ memo: "challenge-a" }),
          getCreateAssociatedTokenIdempotentInstruction({
            ata: splitATA,
            owner: splitReceiver.address,
            payer: createNoopSigner(feePayer.address),
            mint: address(f.request.currency),
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }),
          await createTokenTransferIx(f, splitReceiver.address, 250000n),
          getAddMemoInstruction({ memo: "split-memo" }),
        ],
        feePayer,
      );

      const result = await verifyChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: feePayer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      t.matchOnly(result, { payer: f.sender.address });
      t.end();
    },
  );

  await t.test(
    "accepts fee payer-owned split ATA creation instruction",
    async (t) => {
      const f = await createTokenFixtures();
      const feePayer = await generateKeyPairSigner();
      const [splitATA] = await findAssociatedTokenPda({
        mint: address(f.request.currency),
        owner: feePayer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          feePayer: true,
          feePayerKey: feePayer.address,
          splits: [
            {
              amount: "250000",
              ataCreationRequired: true,
              memo: "split-memo",
              recipient: feePayer.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          await createTokenTransferIx(f, f.request.recipient, 750000n),
          getAddMemoInstruction({ memo: "challenge-a" }),
          getCreateAssociatedTokenIdempotentInstruction({
            ata: splitATA,
            owner: feePayer.address,
            payer: createNoopSigner(feePayer.address),
            mint: address(f.request.currency),
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }),
          await createTokenTransferIx(f, feePayer.address, 250000n),
          getAddMemoInstruction({ memo: "split-memo" }),
        ],
        feePayer,
      );

      const result = await verifyChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: feePayer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      t.matchOnly(result, { payer: f.sender.address });
      t.end();
    },
  );

  await t.test("rejects fee payer as ATA system program", async (t) => {
    const f = await createTokenFixtures();
    const feePayer = await generateKeyPairSigner();
    const splitReceiver = await generateKeyPairSigner();
    const [splitATA] = await findAssociatedTokenPda({
      mint: address(f.request.currency),
      owner: splitReceiver.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        feePayer: true,
        feePayerKey: feePayer.address,
        splits: [
          {
            amount: "250000",
            ataCreationRequired: true,
            memo: "split-memo",
            recipient: splitReceiver.address,
          },
        ],
      },
    };
    const ataIx = getCreateAssociatedTokenIdempotentInstruction({
      ata: splitATA,
      owner: splitReceiver.address,
      payer: createNoopSigner(feePayer.address),
      mint: address(f.request.currency),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    if (!ataIx.accounts) {
      throw new Error("expected ATA instruction accounts");
    }
    const badATAIx: Instruction = {
      ...ataIx,
      accounts: ataIx.accounts.map((account, index) =>
        index === 4 ? { ...account, address: feePayer.address } : account,
      ),
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        await createTokenTransferIx(f, f.request.recipient, 750000n),
        getAddMemoInstruction({ memo: "challenge-a" }),
        badATAIx,
        await createTokenTransferIx(f, splitReceiver.address, 250000n),
        getAddMemoInstruction({ memo: "split-memo" }),
      ],
      feePayer,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: feePayer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "ATA creation system program does not match charge",
    });
    t.end();
  });

  await t.test("rejects unmarked fee payer split ATA creation", async (t) => {
    const f = await createTokenFixtures();
    const feePayer = await generateKeyPairSigner();
    const splitReceiver = await generateKeyPairSigner();
    const [splitATA] = await findAssociatedTokenPda({
      mint: address(f.request.currency),
      owner: splitReceiver.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        feePayer: true,
        feePayerKey: feePayer.address,
        splits: [
          {
            amount: "250000",
            memo: "split-memo",
            recipient: splitReceiver.address,
          },
        ],
      },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        await createTokenTransferIx(f, f.request.recipient, 750000n),
        getAddMemoInstruction({ memo: "challenge-a" }),
        getCreateAssociatedTokenIdempotentInstruction({
          ata: splitATA,
          owner: splitReceiver.address,
          payer: createNoopSigner(feePayer.address),
          mint: address(f.request.currency),
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        }),
        await createTokenTransferIx(f, splitReceiver.address, 250000n),
        getAddMemoInstruction({ memo: "split-memo" }),
      ],
      feePayer,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: feePayer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "unexpected ATA creation instruction" });
    t.end();
  });

  await t.test("rejects missing required split ATA creation", async (t) => {
    const f = await createTokenFixtures();
    const splitReceiver = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        splits: [
          {
            amount: "250000",
            ataCreationRequired: true,
            memo: "split-memo",
            recipient: splitReceiver.address,
          },
        ],
      },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        await createTokenTransferIx(f, f.request.recipient, 750000n),
        getAddMemoInstruction({ memo: "challenge-a" }),
        await createTokenTransferIx(f, splitReceiver.address, 250000n),
        getAddMemoInstruction({ memo: "split-memo" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "missing required ATA creation instruction" });
    t.end();
  });

  await t.test("rejects top-level recipient ATA creation", async (t) => {
    const f = await createTokenFixtures();
    const [receiverATA] = await findAssociatedTokenPda({
      mint: address(f.request.currency),
      owner: address(f.request.recipient),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        getCreateAssociatedTokenIdempotentInstruction({
          ata: receiverATA,
          owner: address(f.request.recipient),
          payer: createNoopSigner(f.sender.address),
          mint: address(f.request.currency),
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        }),
        f.transferIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { error: "unexpected ATA creation instruction" });
    t.end();
  });

  await t.test(
    "rejects required split ATA creation after transfer",
    async (t) => {
      const f = await createTokenFixtures();
      const splitReceiver = await generateKeyPairSigner();
      const [splitATA] = await findAssociatedTokenPda({
        mint: address(f.request.currency),
        owner: splitReceiver.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          splits: [
            {
              amount: "250000",
              ataCreationRequired: true,
              memo: "split-memo",
              recipient: splitReceiver.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          await createTokenTransferIx(f, f.request.recipient, 750000n),
          getAddMemoInstruction({ memo: "challenge-a" }),
          await createTokenTransferIx(f, splitReceiver.address, 250000n),
          getCreateAssociatedTokenIdempotentInstruction({
            ata: splitATA,
            owner: splitReceiver.address,
            payer: createNoopSigner(f.sender.address),
            mint: address(f.request.currency),
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }),
          getAddMemoInstruction({ memo: "split-memo" }),
        ],
        f.sender,
      );

      const result = await verifyChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: "",
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      t.matchOnly(result, {
        error: "required ATA creation instruction must precede split transfer",
      });
      t.end();
    },
  );

  await t.test("rejects unexpected token instruction", async (t) => {
    const f = await createTokenFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
        getTransferSolInstruction({
          source: createNoopSigner(f.sender.address),
          destination: f.sender.address,
          amount: 1n,
        }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: f.request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "unexpected instruction in charge transaction",
    });
    t.end();
  });

  await t.test(
    "rejects fee payer token account as transfer source",
    async (t) => {
      const f = await createTokenFixtures();
      const feePayer = await generateKeyPairSigner();
      const [feePayerATA] = await findAssociatedTokenPda({
        mint: address(f.request.currency),
        owner: feePayer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const [receiverATA] = await findAssociatedTokenPda({
        mint: address(f.request.currency),
        owner: address(f.request.recipient),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          feePayer: true,
          feePayerKey: feePayer.address,
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          getTransferCheckedInstruction(
            {
              source: feePayerATA,
              mint: address(f.request.currency),
              destination: receiverATA,
              authority: f.sender.address,
              amount: BigInt(request.amount),
              decimals: request.methodDetails?.decimals ?? 6,
            },
            { programAddress: TOKEN_PROGRAM_ADDRESS },
          ),
          getAddMemoInstruction({ memo: "challenge-a" }),
        ],
        feePayer,
      );

      const result = await verifyChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: feePayer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      t.matchOnly(result, {
        error: "transfer source must not be the fee payer",
      });
      t.end();
    },
  );

  await t.test("rejects split token payer mismatch", async (t) => {
    const f = await createTokenFixtures();
    const splitSender = await generateKeyPairSigner();
    const splitReceiver = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        splits: [
          {
            amount: "250000",
            memo: "split-memo",
            recipient: splitReceiver.address,
          },
        ],
      },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        await createTokenTransferIx(f, f.request.recipient, 750000n),
        getAddMemoInstruction({ memo: "challenge-a" }),
        await createTokenTransferIx(
          f,
          splitReceiver.address,
          250000n,
          splitSender.address,
        ),
        getAddMemoInstruction({ memo: "split-memo" }),
      ],
      f.sender,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "split transfer payer must match primary payer",
    });
    t.end();
  });

  await t.test("rejects same transaction against a fresh memo", async (t) => {
    const f = await createTokenFixtures("first-challenge");
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "first-challenge" }),
      ],
      f.sender,
    );

    const replayedRequest: mppChargeRequest = {
      ...f.request,
      externalId: "second-challenge",
    };
    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request: replayedRequest,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "Memo instruction data does not match challenge",
    });
    t.end();
  });

  await t.test("rejects instruction using the fee payer", async (t) => {
    const f = await createTokenFixtures();
    const feePayer = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      ...f.request,
      methodDetails: {
        ...f.request.methodDetails,
        feePayer: true,
        feePayerKey: feePayer.address,
      },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        getAddMemoInstruction({ memo: "challenge-a" }),
        getTransferSolInstruction({
          source: createNoopSigner(feePayer.address),
          destination: f.sender.address,
          amount: 1n,
        }),
      ],
      feePayer,
    );

    const result = await verifyChargeTransaction({
      transactionMessage: txMsg,
      request,
      feePayerAddress: feePayer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, {
      error: "fee payer must not appear in instruction accounts",
    });
    t.end();
  });

  await t.test(
    "rejects one transfer satisfying two identical splits",
    async (t) => {
      const f = await createTokenFixtures();
      const splitReceiver = await generateKeyPairSigner();
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          splits: [
            { amount: "100000", recipient: splitReceiver.address },
            { amount: "100000", recipient: splitReceiver.address },
          ],
        },
      };
      const primaryTransfer = await createTokenTransferIx(
        f,
        f.request.recipient,
        800000n,
      );
      const splitTransfer = await createTokenTransferIx(
        f,
        splitReceiver.address,
        100000n,
      );

      const underpay = await verifyChargeTransaction({
        transactionMessage: buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            primaryTransfer,
            splitTransfer,
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          f.sender,
        ),
        request,
        feePayerAddress: "",
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      t.matchOnly(underpay, {
        error: "no matching transferChecked instruction found",
      });

      const accepted = await verifyChargeTransaction({
        transactionMessage: buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            primaryTransfer,
            splitTransfer,
            await createTokenTransferIx(f, splitReceiver.address, 100000n),
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          f.sender,
        ),
        request,
        feePayerAddress: "",
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      t.matchOnly(accepted, { payer: f.sender.address });
      t.end();
    },
  );

  t.end();
});

await t.test(
  "verifyNativeChargeTransaction validates challenge memo",
  async (t) => {
    await t.test("accepts matching memo", async (t) => {
      const f = await createNativeFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "challenge-a" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { payer: f.sender.address });
      t.end();
    });

    await t.test("rejects missing memo", async (t) => {
      const f = await createNativeFixtures();
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, f.transferIx],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { error: "expected a Memo instruction" });
      t.end();
    });

    await t.test("rejects memo instruction accounts", async (t) => {
      const f = await createNativeFixtures();
      const memoIx: Instruction = {
        ...getAddMemoInstruction({ memo: "challenge-a" }),
        accounts: [
          {
            address: f.sender.address,
            role: AccountRole.WRITABLE_SIGNER,
          },
        ],
      };
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, f.transferIx, memoIx],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "Memo instruction must not include accounts",
      });
      t.end();
    });

    await t.test("rejects empty memo", async (t) => {
      const f = await createNativeFixtures("");
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { error: "unexpected Memo instruction" });
      t.end();
    });

    await t.test("accepts missing challenge memo", async (t) => {
      const f = await createNativeFixtures();
      const request: mppChargeRequest = {
        amount: f.request.amount,
        currency: f.request.currency,
        recipient: f.request.recipient,
        ...(f.request.methodDetails
          ? { methodDetails: f.request.methodDetails }
          : {}),
      };
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, f.transferIx],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { payer: f.sender.address });
      t.end();
    });

    await t.test("rejects mismatched memo", async (t) => {
      const f = await createNativeFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "wrong-challenge" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "Memo instruction data does not match challenge",
      });
      t.end();
    });

    await t.test("rejects non-transfer system instruction", async (t) => {
      const f = await createNativeFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          withNonTransferSolDiscriminator(f.transferIx),
          getAddMemoInstruction({ memo: "challenge-a" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "no matching transferSol instruction found",
      });
      t.end();
    });

    await t.test("rejects fake program native transfer", async (t) => {
      const f = await createNativeFixtures();
      const fakeProgram = await generateKeyPairSigner();
      const fakeIx: Instruction = {
        ...f.transferIx,
        programAddress: fakeProgram.address,
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          fakeIx,
          getAddMemoInstruction({ memo: "challenge-a" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "no matching transferSol instruction found",
      });
      t.end();
    });

    await t.test("rejects additional duplicate challenge memo", async (t) => {
      const f = await createNativeFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "challenge-a" }),
          getAddMemoInstruction({ memo: "challenge-a" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { error: "unexpected Memo instruction" });
      t.end();
    });

    await t.test("rejects additional non-challenge memo", async (t) => {
      const f = await createNativeFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "challenge-a" }),
          getAddMemoInstruction({ memo: "split-memo" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { error: "unexpected Memo instruction" });
      t.end();
    });

    await t.test("accepts split memo matching externalId", async (t) => {
      const f = await createNativeFixtures("shared-memo");
      const splitReceiver = await generateKeyPairSigner();
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          splits: [
            {
              amount: "250000",
              memo: "shared-memo",
              recipient: splitReceiver.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: address(f.request.recipient),
            amount: 750000n,
          }),
          getAddMemoInstruction({ memo: "shared-memo" }),
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: splitReceiver.address,
            amount: 250000n,
          }),
          getAddMemoInstruction({ memo: "shared-memo" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { payer: f.sender.address });
      t.end();
    });

    await t.test("rejects ATA creation flag for native splits", async (t) => {
      const f = await createNativeFixtures();
      const splitReceiver = await generateKeyPairSigner();
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          splits: [
            {
              amount: "250000",
              ataCreationRequired: true,
              recipient: splitReceiver.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: address(f.request.recipient),
            amount: 750000n,
          }),
          getAddMemoInstruction({ memo: "challenge-a" }),
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: splitReceiver.address,
            amount: 250000n,
          }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "ataCreationRequired requires an SPL token charge",
      });
      t.end();
    });

    await t.test("rejects unexpected native instruction", async (t) => {
      const f = await createNativeFixtures();
      const extraRecipient = await generateKeyPairSigner();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "challenge-a" }),
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: extraRecipient.address,
            amount: 1n,
          }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: f.request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "unexpected instruction in charge transaction",
      });
      t.end();
    });

    await t.test("rejects split native payer mismatch", async (t) => {
      const f = await createNativeFixtures();
      const splitSender = await generateKeyPairSigner();
      const splitReceiver = await generateKeyPairSigner();
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          splits: [
            {
              amount: "250000",
              memo: "split-memo",
              recipient: splitReceiver.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: address(f.request.recipient),
            amount: 750000n,
          }),
          getAddMemoInstruction({ memo: "challenge-a" }),
          getTransferSolInstruction({
            source: createNoopSigner(splitSender.address),
            destination: splitReceiver.address,
            amount: 250000n,
          }),
          getAddMemoInstruction({ memo: "split-memo" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "split transfer payer must match primary payer",
      });
      t.end();
    });

    await t.test("rejects same transaction against a fresh memo", async (t) => {
      const f = await createNativeFixtures("first-challenge");
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "first-challenge" }),
        ],
        f.sender,
      );

      const replayedRequest: mppChargeRequest = {
        ...f.request,
        externalId: "second-challenge",
      };
      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request: replayedRequest,
        feePayerAddress: "",
      });

      t.matchOnly(result, {
        error: "Memo instruction data does not match challenge",
      });
      t.end();
    });

    await t.test("rejects instruction using the fee payer", async (t) => {
      const f = await createNativeFixtures();
      const feePayer = await generateKeyPairSigner();
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          feePayer: true,
          feePayerKey: feePayer.address,
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          getAddMemoInstruction({ memo: "challenge-a" }),
          getTransferSolInstruction({
            source: createNoopSigner(feePayer.address),
            destination: f.sender.address,
            amount: 1n,
          }),
        ],
        feePayer,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: feePayer.address,
      });

      t.matchOnly(result, {
        error: "fee payer must not appear in instruction accounts",
      });
      t.end();
    });

    await t.test(
      "accepts fee payer as native transfer recipient",
      async (t) => {
        const feePayer = await generateKeyPairSigner();
        const f = await createNativeFixtures();
        const request: mppChargeRequest = {
          ...f.request,
          recipient: feePayer.address,
          methodDetails: {
            ...f.request.methodDetails,
            feePayer: true,
            feePayerKey: feePayer.address,
          },
        };
        const transferIx = getTransferSolInstruction({
          source: createNoopSigner(f.sender.address),
          destination: feePayer.address,
          amount: BigInt(request.amount),
        });
        const txMsg = buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            transferIx,
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          feePayer,
        );

        const result = await verifyNativeChargeTransaction({
          transactionMessage: txMsg,
          request,
          feePayerAddress: feePayer.address,
        });

        t.matchOnly(result, { payer: f.sender.address });
        t.end();
      },
    );

    await t.test(
      "rejects custom instruction using fee payer as native recipient",
      async (t) => {
        const feePayer = await generateKeyPairSigner();
        const fakeProgram = await generateKeyPairSigner();
        const f = await createNativeFixtures();
        const request: mppChargeRequest = {
          ...f.request,
          recipient: feePayer.address,
          methodDetails: {
            ...f.request.methodDetails,
            feePayer: true,
            feePayerKey: feePayer.address,
          },
        };
        const baseIx = getTransferSolInstruction(
          {
            source: createNoopSigner(f.sender.address),
            destination: feePayer.address,
            amount: BigInt(request.amount),
          },
          { programAddress: fakeProgram.address },
        );
        const fakeIx: Instruction = {
          ...baseIx,
          accounts: [
            ...baseIx.accounts,
            {
              address: feePayer.address,
              role: AccountRole.WRITABLE_SIGNER,
            },
          ],
        };
        const txMsg = buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            fakeIx,
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          feePayer,
        );

        const result = await verifyNativeChargeTransaction({
          transactionMessage: txMsg,
          request,
          feePayerAddress: feePayer.address,
        });

        t.matchOnly(result, {
          error: "fee payer must not appear in instruction accounts",
        });
        t.end();
      },
    );

    await t.test(
      "rejects non-transfer system instruction using fee payer as native recipient",
      async (t) => {
        const feePayer = await generateKeyPairSigner();
        const f = await createNativeFixtures();
        const request: mppChargeRequest = {
          ...f.request,
          recipient: feePayer.address,
          methodDetails: {
            ...f.request.methodDetails,
            feePayer: true,
            feePayerKey: feePayer.address,
          },
        };
        const baseIx = getTransferSolInstruction({
          source: createNoopSigner(f.sender.address),
          destination: feePayer.address,
          amount: BigInt(request.amount),
        });
        const txMsg = buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            withNonTransferSolDiscriminator(baseIx),
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          feePayer,
        );

        const result = await verifyNativeChargeTransaction({
          transactionMessage: txMsg,
          request,
          feePayerAddress: feePayer.address,
        });

        t.matchOnly(result, {
          error: "fee payer must not appear in instruction accounts",
        });
        t.end();
      },
    );

    await t.test(
      "rejects extra fee payer account on native transfer",
      async (t) => {
        const feePayer = await generateKeyPairSigner();
        const f = await createNativeFixtures();
        const request: mppChargeRequest = {
          ...f.request,
          recipient: feePayer.address,
          methodDetails: {
            ...f.request.methodDetails,
            feePayer: true,
            feePayerKey: feePayer.address,
          },
        };
        const baseIx = getTransferSolInstruction({
          source: createNoopSigner(f.sender.address),
          destination: feePayer.address,
          amount: BigInt(request.amount),
        });
        const transferIx: Instruction = {
          ...baseIx,
          accounts: [
            ...baseIx.accounts,
            {
              address: feePayer.address,
              role: AccountRole.WRITABLE_SIGNER,
            },
          ],
        };
        const txMsg = buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            transferIx,
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          feePayer,
        );

        const result = await verifyNativeChargeTransaction({
          transactionMessage: txMsg,
          request,
          feePayerAddress: feePayer.address,
        });

        t.matchOnly(result, {
          error: "fee payer must not appear in instruction accounts",
        });
        t.end();
      },
    );

    await t.test("accepts native memos in any order", async (t) => {
      const f = await createNativeFixtures();
      const splitReceiver = await generateKeyPairSigner();
      const request: mppChargeRequest = {
        ...f.request,
        methodDetails: {
          ...f.request.methodDetails,
          splits: [
            {
              amount: "250000",
              memo: "split-memo",
              recipient: splitReceiver.address,
            },
          ],
        },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: address(f.request.recipient),
            amount: 750000n,
          }),
          getTransferSolInstruction({
            source: createNoopSigner(f.sender.address),
            destination: splitReceiver.address,
            amount: 250000n,
          }),
          getAddMemoInstruction({ memo: "split-memo" }),
          getAddMemoInstruction({ memo: "challenge-a" }),
        ],
        f.sender,
      );

      const result = await verifyNativeChargeTransaction({
        transactionMessage: txMsg,
        request,
        feePayerAddress: "",
      });

      t.matchOnly(result, { payer: f.sender.address });
      t.end();
    });

    await t.test(
      "rejects duplicate primary transfer to recipient",
      async (t) => {
        const f = await createNativeFixtures();
        const duplicate = getTransferSolInstruction({
          source: createNoopSigner(f.sender.address),
          destination: address(f.request.recipient),
          amount: BigInt(f.request.amount),
        });
        const txMsg = buildTxMessage(
          [
            f.computeLimitIx,
            f.computePriceIx,
            f.transferIx,
            duplicate,
            getAddMemoInstruction({ memo: "challenge-a" }),
          ],
          f.sender,
        );

        const result = await verifyNativeChargeTransaction({
          transactionMessage: txMsg,
          request: f.request,
          feePayerAddress: "",
        });

        t.matchOnly(result, {
          error: "unexpected instruction in charge transaction",
        });
        t.end();
      },
    );

    t.end();
  },
);
