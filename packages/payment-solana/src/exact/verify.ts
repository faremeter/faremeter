import type { x402PaymentRequirements } from "@faremeter/types/x402";
import { isValidationError } from "@faremeter/types";
import {
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  parseCreateAssociatedTokenInstruction,
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  type CompilableTransactionMessage,
  type Instruction,
} from "@solana/kit";
import { PaymentRequirementsExtra } from "./facilitator";
import { logger } from "./logger";
import type { PublicKey } from "@solana/web3.js";

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

function calculatePriorityFee(units: number, microLamports: bigint): number {
  return (units * Number(microLamports)) / 1_000_000;
}

async function verifyTransferInstruction(
  instruction: Instruction,
  paymentRequirements: x402PaymentRequirements,
  destination: string,
  facilitatorAddress: string,
): Promise<boolean> {
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
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  if (transfer.accounts.source.address === facilitatorATA) {
    logger.error("Dropping transfer where the source is the facilitator");
    return false;
  }

  return (
    transfer.data.amount === BigInt(paymentRequirements.maxAmountRequired) &&
    transfer.accounts.mint.address === paymentRequirements.asset &&
    transfer.accounts.destination.address === destination
  );
}

function verifyCreateATAInstruction(
  instruction: Instruction,
  facilitatorAddress: string,
): boolean {
  if (!instruction.data || !instruction.accounts) {
    return false;
  }

  try {
    const createInstruction = parseCreateAssociatedTokenInstruction({
      accounts: instruction.accounts,
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });

    if (createInstruction.accounts.payer.address === facilitatorAddress) {
      logger.error(
        "Dropping transaction where the facilitator pays for a token account creation",
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function isValidTransaction(
  transactionMessage: CompilableTransactionMessage,
  paymentRequirements: x402PaymentRequirements,
  facilitatorAddress: PublicKey,
  maxPriorityFee?: number,
): Promise<boolean> {
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
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const instructions = transactionMessage.instructions;
  const facilitatorBase58 = facilitatorAddress.toBase58();

  if (instructions.length === 3) {
    // Make typescript happy...
    const [ix0, ix1, ix2] = instructions;
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

    return await verifyTransferInstruction(
      ix2,
      paymentRequirements,
      destination,
      facilitatorBase58,
    );
  } else if (instructions.length === 4) {
    const [ix0, ix1, ix2, ix3] = instructions;
    if (!ix0 || !ix1 || !ix2 || !ix3) {
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

    return (
      verifyCreateATAInstruction(ix2, facilitatorBase58) &&
      (await verifyTransferInstruction(
        ix3,
        paymentRequirements,
        destination,
        facilitatorBase58,
      ))
    );
  }

  return false;
}
