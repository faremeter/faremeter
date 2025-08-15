import {
  isValidationError,
  type x402PaymentRequirements,
} from "@faremeter/types";
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

function verifyComputeUnitLimitInstruction(instruction: Instruction): boolean {
  if (!instruction.data) {
    return false;
  }

  try {
    parseSetComputeUnitLimitInstruction({
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    return true;
  } catch {
    return false;
  }
}

function verifyComputeUnitPriceInstruction(instruction: Instruction): boolean {
  if (!instruction.data) {
    return false;
  }

  try {
    parseSetComputeUnitPriceInstruction({
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    return true;
  } catch {
    return false;
  }
}

async function verifyTransferInstruction(
  instruction: Instruction,
  paymentRequirements: x402PaymentRequirements,
  destination: string,
): Promise<boolean> {
  try {
    if (!instruction.data || !instruction.accounts) {
      return false;
    }

    const transfer = parseTransferCheckedInstruction({
      accounts: instruction.accounts,
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });

    return (
      transfer.data.amount === BigInt(paymentRequirements.maxAmountRequired) &&
      transfer.accounts.mint.address === paymentRequirements.asset &&
      transfer.accounts.destination.address === destination
    );
  } catch {
    return false;
  }
}

function verifyCreateATAInstruction(instruction: Instruction): boolean {
  if (!instruction.data || !instruction.accounts) {
    return false;
  }

  try {
    parseCreateAssociatedTokenInstruction({
      accounts: instruction.accounts,
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    return true;
  } catch {
    return false;
  }
}

export async function isValidTransaction(
  transactionMessage: CompilableTransactionMessage,
  paymentRequirements: x402PaymentRequirements,
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

  if (instructions.length === 3) {
    // Make typescript happy...
    if (!instructions[0] || !instructions[1] || !instructions[2]) {
      return false;
    }

    return (
      verifyComputeUnitLimitInstruction(instructions[0]) &&
      verifyComputeUnitPriceInstruction(instructions[1]) &&
      (await verifyTransferInstruction(
        instructions[2],
        paymentRequirements,
        destination,
      ))
    );
  } else if (instructions.length === 4) {
    if (
      !instructions[0] ||
      !instructions[1] ||
      !instructions[2] ||
      !instructions[3]
    ) {
      return false;
    }

    return (
      verifyComputeUnitLimitInstruction(instructions[0]) &&
      verifyComputeUnitPriceInstruction(instructions[1]) &&
      verifyCreateATAInstruction(instructions[2]) &&
      (await verifyTransferInstruction(
        instructions[3],
        paymentRequirements,
        destination,
      ))
    );
  }

  return false;
}
