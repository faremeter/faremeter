import {
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { parseTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  parseTransferCheckedInstruction,
} from "@solana-program/token";
import {
  address,
  type Address,
  type CompilableTransactionMessage,
  type Instruction,
} from "@solana/kit";
import type { mppChargeRequest } from "./common";
import { logger } from "./logger";

const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;

/**
 * Scans instructions for compute budget settings and calculates the
 * effective priority fee. Returns 0 when no compute budget instructions
 * are present. Uses the highest fee found when duplicates exist
 * (conservative for cap enforcement).
 */
function calculatePriorityFee(instructions: readonly Instruction[]): number {
  let highestLimit = 0;
  let highestMicroLamports = 0n;
  let foundLimit = false;
  let foundPrice = false;

  for (const ix of instructions) {
    if (!ix.data) continue;
    const data = new Uint8Array(ix.data);

    try {
      const limit = parseSetComputeUnitLimitInstruction({
        programAddress: ix.programAddress,
        data,
      });
      foundLimit = true;
      if (limit.data.units > highestLimit) {
        highestLimit = limit.data.units;
      }
      continue;
    } catch {
      // not a setComputeUnitLimit instruction
    }

    try {
      const price = parseSetComputeUnitPriceInstruction({
        programAddress: ix.programAddress,
        data,
      });
      foundPrice = true;
      if (price.data.microLamports > highestMicroLamports) {
        highestMicroLamports = price.data.microLamports;
      }
    } catch {
      // not a setComputeUnitPrice instruction
    }
  }

  if (!foundPrice) return 0;

  const units = foundLimit ? highestLimit : DEFAULT_COMPUTE_UNIT_LIMIT;
  return (units * Number(highestMicroLamports)) / 1_000_000;
}

export type VerifyChargeTransactionArgs = {
  transactionMessage: CompilableTransactionMessage;
  request: mppChargeRequest;
  feePayerAddress: string;
  tokenProgram: Address;
  maxPriorityFee?: number;
};

/**
 * Verifies that a client-submitted transaction matches the charge
 * challenge. Scans the instruction list for a matching transferChecked
 * and caps the priority fee from any compute budget instructions.
 *
 * Returns the payer (transfer authority) address on success, or a
 * string error message on failure.
 */
export async function verifyChargeTransaction(
  args: VerifyChargeTransactionArgs,
): Promise<{ payer: string } | { error: string }> {
  const { transactionMessage, request, feePayerAddress, tokenProgram } = args;
  const md = request.methodDetails;

  if (md?.feePayer && transactionMessage.feePayer.address !== feePayerAddress) {
    return { error: "fee payer does not match challenge" };
  }

  const instructions = transactionMessage.instructions;

  const maxFee = args.maxPriorityFee ?? 100_000;
  const priorityFee = calculatePriorityFee(instructions);
  if (priorityFee > maxFee) {
    return {
      error: `priority fee ${priorityFee} exceeds maximum ${maxFee}`,
    };
  }

  const [expectedATA] = await findAssociatedTokenPda({
    mint: address(request.currency),
    owner: address(request.recipient),
    tokenProgram,
  });

  for (const ix of instructions) {
    if (!ix.data || !ix.accounts) continue;

    let transfer;
    try {
      transfer = parseTransferCheckedInstruction({
        accounts: ix.accounts,
        programAddress: ix.programAddress,
        data: new Uint8Array(ix.data),
      });
    } catch {
      continue;
    }

    if (transfer.data.amount !== BigInt(request.amount)) {
      logger.debug("transfer amount mismatch", {
        expected: request.amount,
        actual: transfer.data.amount.toString(),
      });
      continue;
    }

    if (transfer.accounts.mint.address !== request.currency) {
      logger.debug("transfer mint mismatch", {
        expected: request.currency,
        actual: transfer.accounts.mint.address,
      });
      continue;
    }

    if (md?.decimals !== undefined && transfer.data.decimals !== md.decimals) {
      logger.debug("transfer decimals mismatch", {
        expected: md.decimals,
        actual: transfer.data.decimals,
      });
      continue;
    }

    if (transfer.accounts.destination.address !== expectedATA) {
      logger.debug("transfer destination mismatch", {
        expected: expectedATA,
        actual: transfer.accounts.destination.address,
      });
      continue;
    }

    if (transfer.accounts.authority.address === feePayerAddress) {
      return { error: "transfer authority must not be the fee payer" };
    }

    return { payer: transfer.accounts.authority.address };
  }

  return { error: "no matching transferChecked instruction found" };
}

export type VerifyNativeChargeTransactionArgs = {
  transactionMessage: CompilableTransactionMessage;
  request: mppChargeRequest;
  feePayerAddress: string;
  maxPriorityFee?: number;
};

/**
 * Verifies that a client-submitted transaction matches a native SOL
 * charge challenge. Scans the instruction list for a matching System
 * Program transferSol and caps the priority fee.
 */
export async function verifyNativeChargeTransaction(
  args: VerifyNativeChargeTransactionArgs,
): Promise<{ payer: string } | { error: string }> {
  const { transactionMessage, request, feePayerAddress } = args;
  const md = request.methodDetails;

  if (md?.feePayer && transactionMessage.feePayer.address !== feePayerAddress) {
    return { error: "fee payer does not match challenge" };
  }

  const instructions = transactionMessage.instructions;

  const maxFee = args.maxPriorityFee ?? 100_000;
  const priorityFee = calculatePriorityFee(instructions);
  if (priorityFee > maxFee) {
    return {
      error: `priority fee ${priorityFee} exceeds maximum ${maxFee}`,
    };
  }

  const expectedRecipient = address(request.recipient);

  for (const ix of instructions) {
    if (!ix.data || !ix.accounts) continue;

    let transfer;
    try {
      transfer = parseTransferSolInstruction({
        accounts: ix.accounts,
        programAddress: ix.programAddress,
        data: new Uint8Array(ix.data),
      });
    } catch {
      continue;
    }

    if (transfer.data.amount !== BigInt(request.amount)) {
      logger.debug("native transfer amount mismatch", {
        expected: request.amount,
        actual: transfer.data.amount.toString(),
      });
      continue;
    }

    if (transfer.accounts.destination.address !== expectedRecipient) {
      logger.debug("native transfer destination mismatch", {
        expected: expectedRecipient,
        actual: transfer.accounts.destination.address,
      });
      continue;
    }

    if (transfer.accounts.source.address === feePayerAddress) {
      return { error: "transfer source must not be the fee payer" };
    }

    return { payer: transfer.accounts.source.address };
  }

  return { error: "no matching transferSol instruction found" };
}
