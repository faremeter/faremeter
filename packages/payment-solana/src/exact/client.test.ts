#!/usr/bin/env pnpm tsx

import t from "tap";
import { address } from "@solana/kit";

import { createPaymentHandler } from "./client";

const LARGE_AMOUNT = "9007199254740993";
const MINT = "11111111111111111111111111111111" as const;
const WALLET = "11111111111111111111111111111111" as const;
const FEE_PAYER = "11111111111111111111111111111111" as const;
const PAY_TO = "11111111111111111111111111111111" as const;

await t.test(
  "client exact payment preserves large atomic amounts",
  async (t) => {
    const builtInstructionData: Uint8Array[] = [];

    const handler = createPaymentHandler(
      {
        network: "solana:mainnet",
        publicKey: address(WALLET),
        buildTransaction: async (instructions) => {
          for (const instruction of instructions) {
            if (instruction.data)
              builtInstructionData.push(new Uint8Array(instruction.data));
          }
          return new Uint8Array() as never;
        },
        partiallySignTransaction: async (tx) => tx,
      },
      address(MINT),
    );

    const execers = await handler({} as never, [
      {
        scheme: "exact",
        network: "solana:mainnet",
        asset: MINT,
        payTo: PAY_TO,
        amount: LARGE_AMOUNT,
        maxTimeoutSeconds: 60,
        extra: {
          feePayer: FEE_PAYER,
          decimals: 6,
          recentBlockhash: "11111111111111111111111111111111",
        },
      },
    ]);

    t.equal(execers.length, 1);
    await t.rejects(execers[0]!.exec(), /length/);

    const transferCheckedData = builtInstructionData.find(
      (data) => data[0] === 12,
    );
    t.ok(transferCheckedData, "builds a TransferChecked instruction");
    t.equal(
      transferCheckedData &&
        new DataView(
          transferCheckedData.buffer,
          transferCheckedData.byteOffset + 1,
          8,
        ).getBigUint64(0, true),
      BigInt(LARGE_AMOUNT),
    );
  },
);
