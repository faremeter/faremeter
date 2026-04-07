import type { x402PaymentRequirements } from "@faremeter/types/x402v2";
import { isValidationError } from "@faremeter/types";
import {
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  parseTransferCheckedInstruction,
} from "@solana-program/token";
import { address, type Address, type Instruction } from "@solana/kit";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { PaymentRequirementsExtra } from "./facilitator";
import type { CompilableTransactionMessage } from "../common";
import { logger } from "./logger";

const LIGHTHOUSE_PROGRAM_ADDRESS = address(
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
);

function isLighthouseInstruction(instruction: Instruction) {
  return instruction.programAddress === LIGHTHOUSE_PROGRAM_ADDRESS;
}

function isMemoInstruction(instruction: Instruction) {
  return instruction.programAddress === MEMO_PROGRAM_ADDRESS;
}

function isAllowedTrailingInstruction(instruction: Instruction) {
  return isLighthouseInstruction(instruction) || isMemoInstruction(instruction);
}

function getMemoData(instruction: Instruction): string | undefined {
  if (!isMemoInstruction(instruction) || !instruction.data) {
    return undefined;
  }
  return new TextDecoder().decode(new Uint8Array(instruction.data));
}

function verifyComputeUnitLimitInstruction(instruction: Instruction): {
  valid: boolean;
  units?: number;
} {
  if (!instruction.data) {
    return { valid: false };
  }

  try {
    const parsed = parseSetComputeUnitLimitInstruction({
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    return { valid: true, units: parsed.data.units };
  } catch {
    return { valid: false };
  }
}

function verifyComputeUnitPriceInstruction(instruction: Instruction): {
  valid: boolean;
  microLamports?: bigint;
} {
  if (!instruction.data) {
    return { valid: false };
  }

  try {
    const parsed = parseSetComputeUnitPriceInstruction({
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    return { valid: true, microLamports: parsed.data.microLamports };
  } catch {
    return { valid: false };
  }
}

// The upstream spec caps the per-CU price (<=5 lamports/CU), but that still
// allows an attacker to inflate the CU limit to the Solana maximum and drain
// the facilitator's SOL.  A total-fee cap closes that vector because the
// facilitator is the one paying the priority fee.
function calculatePriorityFee(units: number, microLamports: bigint): number {
  return (units * Number(microLamports)) / 1_000_000;
}

async function verifyTransferInstruction(
  instruction: Instruction,
  paymentRequirements: x402PaymentRequirements,
  destination: string,
  facilitatorAddress: string,
  tokenProgram: Address,
): Promise<string | false> {
  if (!instruction.data || !instruction.accounts) {
    return false;
  }

  let transfer;
  try {
    transfer = parseTransferCheckedInstruction({
      accounts: instruction.accounts,
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
  } catch {
    return false;
  }

  if (transfer.accounts.authority.address === facilitatorAddress) {
    logger.error(
      "Dropping transfer where the transfer authority is the facilitator",
    );
    return false;
  }

  const [facilitatorATA] = await findAssociatedTokenPda({
    mint: address(paymentRequirements.asset),
    owner: address(facilitatorAddress),
    tokenProgram,
  });

  if (transfer.accounts.source.address === facilitatorATA) {
    logger.error("Dropping transfer where the source is the facilitator");
    return false;
  }

  if (
    transfer.data.amount === BigInt(paymentRequirements.amount) &&
    transfer.accounts.mint.address === paymentRequirements.asset &&
    transfer.accounts.destination.address === destination
  ) {
    return transfer.accounts.authority.address;
  }
  return false;
}

export async function isValidTransaction(
  transactionMessage: CompilableTransactionMessage,
  paymentRequirements: x402PaymentRequirements,
  facilitatorAddress: string,
  tokenProgram: Address,
  maxPriorityFee?: number,
): Promise<{ payer: string } | false> {
  const extra = PaymentRequirementsExtra(paymentRequirements.extra);
  if (isValidationError(extra)) {
    throw new Error("feePayer is required");
  }

  if (transactionMessage.feePayer.address !== extra.feePayer) {
    return false;
  }

  const [destination] = await findAssociatedTokenPda({
    mint: address(paymentRequirements.asset),
    owner: address(paymentRequirements.payTo),
    tokenProgram,
  });

  const instructions = transactionMessage.instructions;

  if (instructions.length < 3 || instructions.length > 6) {
    return false;
  }

  const [ix0, ix1, ix2, ...rest] = instructions;
  if (!ix0 || !ix1 || !ix2) {
    return false;
  }

  const limitResult = verifyComputeUnitLimitInstruction(ix0);
  const priceResult = verifyComputeUnitPriceInstruction(ix1);

  if (!limitResult.valid || !priceResult.valid) {
    return false;
  }

  if (
    maxPriorityFee !== undefined &&
    limitResult.units !== undefined &&
    priceResult.microLamports !== undefined
  ) {
    const priorityFee = calculatePriorityFee(
      limitResult.units,
      priceResult.microLamports,
    );
    if (priorityFee > maxPriorityFee) {
      logger.error(
        `Priority fee ${priorityFee} exceeds maximum ${maxPriorityFee}`,
      );
      return false;
    }
  }

  if (!rest.every(isAllowedTrailingInstruction)) {
    logger.error("Dropping transaction with unexpected trailing instructions");
    return false;
  }

  const facilitator = address(facilitatorAddress);
  for (const ix of instructions) {
    if (!ix.accounts) continue;
    for (const account of ix.accounts) {
      if (account.address === facilitator) {
        logger.error(
          "Dropping transaction where the facilitator appears in instruction accounts",
        );
        return false;
      }
    }
  }

  const memoInstructions = rest.filter(isMemoInstruction);

  if (memoInstructions.length !== 1) {
    logger.error("Expected exactly one Memo instruction");
    return false;
  }

  if (extra.memo !== undefined) {
    const memoIx = memoInstructions[0];
    if (!memoIx) {
      return false;
    }

    const memoData = getMemoData(memoIx);
    if (memoData !== extra.memo) {
      logger.error("Memo instruction data does not match extra.memo");
      return false;
    }
  }

  const payer = await verifyTransferInstruction(
    ix2,
    paymentRequirements,
    destination,
    facilitatorAddress,
    tokenProgram,
  );
  if (!payer) return false;
  return { payer };
}
