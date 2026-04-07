#!/usr/bin/env pnpm tsx

import t from "tap";
import { isValidTransaction } from "./verify";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../splToken";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import type { Blockhash } from "@solana/rpc-types";
import type { x402PaymentRequirements } from "@faremeter/types/x402v2";
import type { CompilableTransactionMessage } from "../common";

function createRequirements(
  overrides: Partial<x402PaymentRequirements> & {
    amount: string;
    payTo: string;
    asset: string;
    extra: { feePayer: string };
  },
): x402PaymentRequirements {
  return {
    scheme: "exact",
    network: "solana-devnet",
    maxTimeoutSeconds: 30,
    ...overrides,
  };
}

const LIGHTHOUSE_PROGRAM_ADDRESS = address(
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
);

const FAKE_BLOCKHASH =
  "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;

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

async function createFixtures({
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
}: { tokenProgram?: Address } = {}) {
  const facilitator = await generateKeyPairSigner();
  const sender = await generateKeyPairSigner();
  const receiver = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();

  const [senderATA] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: sender.address,
    tokenProgram,
  });
  const [receiverATA] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: receiver.address,
    tokenProgram,
  });
  const [facilitatorATA] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: facilitator.address,
    tokenProgram,
  });

  const amount = 1_000_000n;
  const decimals = 6;

  const requirements = createRequirements({
    amount: amount.toString(),
    payTo: receiver.address.toString(),
    asset: mint.address.toString(),
    extra: {
      feePayer: facilitator.address.toString(),
    },
  });

  const computeLimitIx = getSetComputeUnitLimitInstruction({
    units: 50_000,
  });
  const computePriceIx = getSetComputeUnitPriceInstruction({
    microLamports: 1n,
  });
  const transferIx = getTransferCheckedInstruction(
    {
      source: senderATA,
      mint: mint.address,
      destination: receiverATA,
      authority: sender.address,
      amount,
      decimals,
    },
    { programAddress: tokenProgram },
  );

  return {
    tokenProgram,
    facilitator,
    sender,
    receiver,
    mint,
    senderATA,
    receiverATA,
    facilitatorATA,
    amount,
    decimals,
    requirements,
    computeLimitIx,
    computePriceIx,
    transferIx,
  };
}

function makeLighthouseIx(data?: number[]): Instruction {
  return {
    programAddress: LIGHTHOUSE_PROGRAM_ADDRESS,
    data: new Uint8Array(data ?? [0]),
  };
}

function makeMemoIx(memo: string): Instruction {
  return {
    programAddress: MEMO_PROGRAM_ADDRESS,
    data: new TextEncoder().encode(memo),
  };
}

await t.test("isValidTransaction", async (t) => {
  await t.test("accepts valid 4-instruction transaction", async (t) => {
    const f = await createFixtures();
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx, makeMemoIx("nonce")],
      f.facilitator,
    );
    const result = await isValidTransaction(
      txMsg,
      f.requirements,
      f.facilitator.address,
      f.tokenProgram,
    );
    t.ok(result);
    t.equal(result && result.payer, f.sender.address);
    t.end();
  });

  await t.test(
    "accepts valid 5-instruction transaction with one lighthouse ix",
    async (t) => {
      const f = await createFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          makeLighthouseIx(),
          makeMemoIx("nonce"),
        ],
        f.facilitator,
      );
      const result = await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      );
      t.ok(result);
      t.equal(result && result.payer, f.sender.address);
      t.end();
    },
  );

  await t.test(
    "accepts valid 6-instruction transaction with two lighthouse ixs",
    async (t) => {
      const f = await createFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          makeLighthouseIx([1]),
          makeLighthouseIx([2]),
          makeMemoIx("nonce"),
        ],
        f.facilitator,
      );
      const result = await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      );
      t.ok(result);
      t.equal(result && result.payer, f.sender.address);
      t.end();
    },
  );

  await t.test(
    "rejects transaction with fewer than 3 instructions",
    async (t) => {
      const f = await createFixtures();
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test(
    "rejects transaction with more than 6 instructions",
    async (t) => {
      const f = await createFixtures();
      const extras = Array.from({ length: 4 }, (_, i) => makeLighthouseIx([i]));
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, f.transferIx, ...extras],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test("rejects transaction without memo instruction", async (t) => {
    const f = await createFixtures();
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test("rejects transaction with wrong fee payer", async (t) => {
    const f = await createFixtures();
    const wrongPayer = await generateKeyPairSigner();
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx],
      wrongPayer,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test("throws when extra is missing feePayer", async (t) => {
    const f = await createFixtures();
    const badRequirements = {
      ...f.requirements,
      extra: {},
    };
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx],
      f.facilitator,
    );
    await t.rejects(
      isValidTransaction(
        txMsg,
        badRequirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
    );
    t.end();
  });

  await t.test(
    "rejects transaction with swapped compute budget instructions",
    async (t) => {
      const f = await createFixtures();
      const txMsg = buildTxMessage(
        [f.computePriceIx, f.computeLimitIx, f.transferIx],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test("accepts transaction within priority fee limit", async (t) => {
    const f = await createFixtures();
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx, makeMemoIx("nonce")],
      f.facilitator,
    );
    const result = await isValidTransaction(
      txMsg,
      f.requirements,
      f.facilitator.address,
      f.tokenProgram,
      100_000,
    );
    t.ok(result);
    t.equal(result && result.payer, f.sender.address);
    t.end();
  });

  await t.test(
    "rejects transaction exceeding priority fee limit",
    async (t) => {
      const f = await createFixtures();
      const highLimitIx = getSetComputeUnitLimitInstruction({
        units: 200_000,
      });
      const highPriceIx = getSetComputeUnitPriceInstruction({
        microLamports: 10_000_000n,
      });
      const txMsg = buildTxMessage(
        [highLimitIx, highPriceIx, f.transferIx, makeMemoIx("nonce")],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
          100,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test(
    "rejects transaction exceeding priority fee limit with lighthouse ixs",
    async (t) => {
      const f = await createFixtures();
      const highLimitIx = getSetComputeUnitLimitInstruction({
        units: 200_000,
      });
      const highPriceIx = getSetComputeUnitPriceInstruction({
        microLamports: 10_000_000n,
      });
      const txMsg = buildTxMessage(
        [
          highLimitIx,
          highPriceIx,
          f.transferIx,
          makeLighthouseIx(),
          makeMemoIx("nonce"),
        ],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
          100,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test("rejects trailing non-lighthouse instruction", async (t) => {
    const f = await createFixtures();
    const randomSigner = await generateKeyPairSigner();
    const fakeIx: Instruction = {
      programAddress: randomSigner.address,
      data: new Uint8Array([0]),
    };
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx, fakeIx],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test(
    "rejects mixed lighthouse and non-lighthouse trailing instructions",
    async (t) => {
      const f = await createFixtures();
      const randomSigner = await generateKeyPairSigner();
      const fakeIx: Instruction = {
        programAddress: randomSigner.address,
        data: new Uint8Array([0]),
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          makeLighthouseIx(),
          fakeIx,
        ],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test("rejects transaction with wrong transfer amount", async (t) => {
    const f = await createFixtures();
    const wrongAmountIx = getTransferCheckedInstruction({
      source: f.senderATA,
      mint: f.mint.address,
      destination: f.receiverATA,
      authority: f.sender.address,
      amount: f.amount + 1n,
      decimals: f.decimals,
    });
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, wrongAmountIx, makeMemoIx("nonce")],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test("rejects transaction with wrong mint", async (t) => {
    const f = await createFixtures();
    const wrongMint = await generateKeyPairSigner();
    const [wrongMintSenderATA] = await findAssociatedTokenPda({
      mint: wrongMint.address,
      owner: f.sender.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [wrongMintReceiverATA] = await findAssociatedTokenPda({
      mint: wrongMint.address,
      owner: f.receiver.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const wrongMintIx = getTransferCheckedInstruction({
      source: wrongMintSenderATA,
      mint: wrongMint.address,
      destination: wrongMintReceiverATA,
      authority: f.sender.address,
      amount: f.amount,
      decimals: f.decimals,
    });
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, wrongMintIx, makeMemoIx("nonce")],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test("rejects transaction with wrong destination", async (t) => {
    const f = await createFixtures();
    const wrongReceiver = await generateKeyPairSigner();
    const [wrongReceiverATA] = await findAssociatedTokenPda({
      mint: f.mint.address,
      owner: wrongReceiver.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const wrongDestIx = getTransferCheckedInstruction({
      source: f.senderATA,
      mint: f.mint.address,
      destination: wrongReceiverATA,
      authority: f.sender.address,
      amount: f.amount,
      decimals: f.decimals,
    });
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, wrongDestIx, makeMemoIx("nonce")],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test(
    "rejects transaction where facilitator is transfer authority",
    async (t) => {
      const f = await createFixtures();
      const badIx = getTransferCheckedInstruction({
        source: f.senderATA,
        mint: f.mint.address,
        destination: f.receiverATA,
        authority: f.facilitator.address,
        amount: f.amount,
        decimals: f.decimals,
      });
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, badIx, makeMemoIx("nonce")],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test(
    "rejects transaction where source is facilitator ATA",
    async (t) => {
      const f = await createFixtures();
      const badIx = getTransferCheckedInstruction({
        source: f.facilitatorATA,
        mint: f.mint.address,
        destination: f.receiverATA,
        authority: f.sender.address,
        amount: f.amount,
        decimals: f.decimals,
      });
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, badIx, makeMemoIx("nonce")],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test(
    "accepts valid transaction with Token-2022 program",
    async (t) => {
      const f = await createFixtures({
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, f.transferIx, makeMemoIx("nonce")],
        f.facilitator,
      );
      const result = await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      );
      t.ok(result);
      t.equal(result && result.payer, f.sender.address);
      t.end();
    },
  );

  await t.test("accepts transaction with memo instruction", async (t) => {
    const f = await createFixtures();
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        makeMemoIx("some-random-nonce"),
      ],
      f.facilitator,
    );
    const result = await isValidTransaction(
      txMsg,
      f.requirements,
      f.facilitator.address,
      f.tokenProgram,
    );
    t.ok(result);
    t.equal(result && result.payer, f.sender.address);
    t.end();
  });

  await t.test(
    "accepts transaction with lighthouse and memo instructions",
    async (t) => {
      const f = await createFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          makeLighthouseIx(),
          makeMemoIx("nonce-123"),
        ],
        f.facilitator,
      );
      const result = await isValidTransaction(
        txMsg,
        f.requirements,
        f.facilitator.address,
        f.tokenProgram,
      );
      t.ok(result);
      t.equal(result && result.payer, f.sender.address);
      t.end();
    },
  );

  await t.test("validates memo matches extra.memo when set", async (t) => {
    const f = await createFixtures();
    const requirements = {
      ...f.requirements,
      extra: { ...f.requirements.extra, memo: "invoice-456" },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        makeMemoIx("invoice-456"),
      ],
      f.facilitator,
    );
    const result = await isValidTransaction(
      txMsg,
      requirements,
      f.facilitator.address,
      f.tokenProgram,
    );
    t.ok(result);
    t.equal(result && result.payer, f.sender.address);
    t.end();
  });

  await t.test("rejects memo mismatch when extra.memo is set", async (t) => {
    const f = await createFixtures();
    const requirements = {
      ...f.requirements,
      extra: { ...f.requirements.extra, memo: "invoice-456" },
    };
    const txMsg = buildTxMessage(
      [
        f.computeLimitIx,
        f.computePriceIx,
        f.transferIx,
        makeMemoIx("wrong-memo"),
      ],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test(
    "rejects transaction where facilitator appears in trailing instruction accounts",
    async (t) => {
      const f = await createFixtures();
      const badMemoIx: Instruction = {
        programAddress: MEMO_PROGRAM_ADDRESS,
        data: new TextEncoder().encode("nonce"),
        accounts: [
          {
            address: f.facilitator.address,
            role: 0,
          },
        ],
      };
      const txMsg = buildTxMessage(
        [f.computeLimitIx, f.computePriceIx, f.transferIx, badMemoIx],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test(
    "rejects transaction with multiple memo instructions",
    async (t) => {
      const f = await createFixtures();
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          makeMemoIx("nonce-1"),
          makeMemoIx("nonce-2"),
        ],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          f.requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  await t.test("rejects missing memo when extra.memo is set", async (t) => {
    const f = await createFixtures();
    const requirements = {
      ...f.requirements,
      extra: { ...f.requirements.extra, memo: "invoice-456" },
    };
    const txMsg = buildTxMessage(
      [f.computeLimitIx, f.computePriceIx, f.transferIx],
      f.facilitator,
    );
    t.equal(
      await isValidTransaction(
        txMsg,
        requirements,
        f.facilitator.address,
        f.tokenProgram,
      ),
      false,
    );
    t.end();
  });

  await t.test(
    "rejects multiple memo instructions when extra.memo is set",
    async (t) => {
      const f = await createFixtures();
      const requirements = {
        ...f.requirements,
        extra: { ...f.requirements.extra, memo: "invoice-456" },
      };
      const txMsg = buildTxMessage(
        [
          f.computeLimitIx,
          f.computePriceIx,
          f.transferIx,
          makeMemoIx("invoice-456"),
          makeMemoIx("invoice-456"),
        ],
        f.facilitator,
      );
      t.equal(
        await isValidTransaction(
          txMsg,
          requirements,
          f.facilitator.address,
          f.tokenProgram,
        ),
        false,
      );
      t.end();
    },
  );

  t.end();
});
