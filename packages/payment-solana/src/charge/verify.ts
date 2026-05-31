import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
  SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR,
  SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR,
} from "@solana-program/compute-budget";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  parseTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  TRANSFER_SOL_DISCRIMINATOR,
} from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  CREATE_ASSOCIATED_TOKEN_IDEMPOTENT_DISCRIMINATOR,
  findAssociatedTokenPda,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction,
  TRANSFER_CHECKED_DISCRIMINATOR,
} from "@solana-program/token";
import { address, type Address, type Instruction } from "@solana/kit";
import {
  chargeHasATACreationSplits,
  getChargeChallengeMemo,
  getChargeRequestMemoValidationError,
  getChargePrimaryAmount,
  getChargeSplits,
  type mppChargeRequest,
} from "./common";
import type { CompilableTransactionMessage } from "../common";
import { logger } from "./logger";

const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;

function isMemoInstruction(instruction: Instruction) {
  return instruction.programAddress === MEMO_PROGRAM_ADDRESS;
}

const memoEncoder = new TextEncoder();

function memoDataMatches(instruction: Instruction, memo: string): boolean {
  if (!isMemoInstruction(instruction) || !instruction.data) {
    return false;
  }
  const actual = new Uint8Array(instruction.data);
  const expected = memoEncoder.encode(memo);
  if (actual.byteLength !== expected.byteLength) return false;
  return actual.every((byte, index) => byte === expected[index]);
}

function getExpectedMemoEntries(request: mppChargeRequest): string[] {
  const entries: string[] = [];
  const challengeMemo = getChargeChallengeMemo(request);
  if (challengeMemo !== undefined && challengeMemo.length > 0) {
    entries.push(challengeMemo);
  }

  for (const split of getChargeSplits(request)) {
    if (split.memo !== undefined && split.memo.length > 0) {
      entries.push(split.memo);
    }
  }

  return entries;
}

function verifyExpectedMemos(
  instructions: readonly Instruction[],
  request: mppChargeRequest,
): { error: string } | null {
  const memoValidationError = getChargeRequestMemoValidationError(request);
  if (memoValidationError) {
    return { error: memoValidationError };
  }

  const expectedMemoEntries = getExpectedMemoEntries(request);
  const memoInstructions = instructions.filter(isMemoInstruction);
  if (memoInstructions.some((instruction) => instruction.accounts?.length)) {
    return { error: "Memo instruction must not include accounts" };
  }
  if (expectedMemoEntries.length === 0) {
    if (memoInstructions.length > 0) {
      return { error: "unexpected Memo instruction" };
    }
    return null;
  }

  if (memoInstructions.length === 0) {
    return { error: "expected a Memo instruction" };
  }

  const matchedMemoIndexes = new Set<number>();
  for (const expectedMemo of expectedMemoEntries) {
    const memoIndex = memoInstructions.findIndex((memoInstruction, index) => {
      return (
        !matchedMemoIndexes.has(index) &&
        memoDataMatches(memoInstruction, expectedMemo)
      );
    });
    if (memoIndex === -1) {
      return { error: "Memo instruction data does not match challenge" };
    }
    matchedMemoIndexes.add(memoIndex);
  }

  if (matchedMemoIndexes.size !== memoInstructions.length) {
    return { error: "unexpected Memo instruction" };
  }

  return null;
}

function isAllowedComputeBudgetInstruction(instruction: Instruction): boolean {
  if (instruction.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS) {
    return false;
  }
  if (!instruction.data || (instruction.accounts?.length ?? 0) > 0) {
    return false;
  }

  try {
    const limit = parseSetComputeUnitLimitInstruction({
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    if (limit.data.discriminator === SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR) {
      return true;
    }
  } catch {
    // not a setComputeUnitLimit instruction
  }

  try {
    const price = parseSetComputeUnitPriceInstruction({
      programAddress: instruction.programAddress,
      data: new Uint8Array(instruction.data),
    });
    return price.data.discriminator === SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR;
  } catch {
    return false;
  }
}

function verifyNoUnexpectedInstructions(args: {
  allowedInstructionIndexes: ReadonlySet<number>;
  instructions: readonly Instruction[];
}): { error: string } | null {
  const { allowedInstructionIndexes, instructions } = args;

  for (const [index, instruction] of instructions.entries()) {
    if (allowedInstructionIndexes.has(index)) continue;
    if (isMemoInstruction(instruction)) continue;
    if (isAllowedComputeBudgetInstruction(instruction)) continue;
    return { error: "unexpected instruction in charge transaction" };
  }

  return null;
}

function verifyFeePayerNotUsedByInstructions(
  instructions: readonly Instruction[],
  feePayerAddress: string,
  allowAccount?: (
    instruction: Instruction,
    account: NonNullable<Instruction["accounts"]>[number],
    accountIndex: number,
    instructionIndex: number,
  ) => boolean,
): { error: string } | null {
  if (feePayerAddress === "") return null;

  for (const [instructionIndex, ix] of instructions.entries()) {
    if (!ix.accounts) continue;
    for (const [accountIndex, account] of ix.accounts.entries()) {
      if (
        account.address === feePayerAddress &&
        allowAccount?.(ix, account, accountIndex, instructionIndex) !== true
      ) {
        return { error: "fee payer must not appear in instruction accounts" };
      }
    }
  }

  return null;
}

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
    if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS) continue;
    const data = new Uint8Array(ix.data);

    try {
      const limit = parseSetComputeUnitLimitInstruction({
        programAddress: ix.programAddress,
        data,
      });
      if (limit.data.discriminator === SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR) {
        foundLimit = true;
        if (limit.data.units > highestLimit) {
          highestLimit = limit.data.units;
        }
        continue;
      }
    } catch {
      // not a setComputeUnitLimit instruction
    }

    try {
      const price = parseSetComputeUnitPriceInstruction({
        programAddress: ix.programAddress,
        data,
      });
      if (price.data.discriminator === SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR) {
        foundPrice = true;
        if (price.data.microLamports > highestMicroLamports) {
          highestMicroLamports = price.data.microLamports;
        }
      }
    } catch {
      // not a setComputeUnitPrice instruction
    }
  }

  if (!foundPrice) return 0;

  const units = foundLimit ? highestLimit : DEFAULT_COMPUTE_UNIT_LIMIT;
  return (units * Number(highestMicroLamports)) / 1_000_000;
}

function getPrimaryAmountResult(
  request: mppChargeRequest,
): { amount: bigint } | { error: string } {
  try {
    return { amount: getChargePrimaryAmount(request) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "invalid charge splits",
    };
  }
}

async function verifySplitATAInstructions(args: {
  feePayerAddress: string;
  instructions: readonly Instruction[];
  request: mppChargeRequest;
  tokenProgram: Address;
  transactionFeePayer: string;
}): Promise<
  | {
      allowedFeePayerAccountIndexesByInstructionIndex: Map<number, Set<number>>;
      creationIndexesByOwner: Map<string, number[]>;
      instructionIndexes: Set<number>;
    }
  | { error: string }
> {
  const {
    feePayerAddress,
    instructions,
    request,
    tokenProgram,
    transactionFeePayer,
  } = args;
  const splitRecipients = new Set<string>();
  const requiredSplitRecipients = new Set<string>();
  for (const split of getChargeSplits(request)) {
    const recipient = address(split.recipient);
    splitRecipients.add(recipient);
    if (split.ataCreationRequired === true) {
      requiredSplitRecipients.add(recipient);
    }
  }
  // When the facilitator sponsors fees it only funds the ATAs the server
  // marked required; a client paying its own fees may create any split
  // recipient's ATA, since it bears the rent itself.
  const allowedSplitATARecipients =
    feePayerAddress !== "" && transactionFeePayer === feePayerAddress
      ? requiredSplitRecipients
      : splitRecipients;

  const instructionIndexes = new Set<number>();
  const allowedFeePayerAccountIndexesByInstructionIndex = new Map<
    number,
    Set<number>
  >();
  const creationIndexesByOwner = new Map<string, number[]>();
  for (const [index, instruction] of instructions.entries()) {
    if (instruction.programAddress !== ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      continue;
    }
    if (
      !instruction.accounts ||
      instruction.accounts.length !== 6 ||
      !instruction.data
    ) {
      return { error: "invalid ATA creation instruction" };
    }

    let parsed;
    try {
      parsed = parseCreateAssociatedTokenIdempotentInstruction({
        accounts: instruction.accounts,
        programAddress: instruction.programAddress,
        data: new Uint8Array(instruction.data),
      });
    } catch {
      return { error: "invalid ATA creation instruction" };
    }
    if (
      parsed.data.discriminator !==
      CREATE_ASSOCIATED_TOKEN_IDEMPOTENT_DISCRIMINATOR
    ) {
      return { error: "invalid ATA creation instruction" };
    }

    const owner = parsed.accounts.owner.address;
    if (!allowedSplitATARecipients.has(owner)) {
      return { error: "unexpected ATA creation instruction" };
    }
    if (parsed.accounts.payer.address !== transactionFeePayer) {
      return { error: "ATA creation payer must be transaction fee payer" };
    }
    if (parsed.accounts.mint.address !== request.currency) {
      return { error: "ATA creation mint does not match charge" };
    }
    if (parsed.accounts.systemProgram.address !== SYSTEM_PROGRAM_ADDRESS) {
      return { error: "ATA creation system program does not match charge" };
    }
    if (parsed.accounts.tokenProgram.address !== tokenProgram) {
      return { error: "ATA creation token program does not match charge" };
    }

    const [expectedATA] = await findAssociatedTokenPda({
      mint: address(request.currency),
      owner: address(owner),
      tokenProgram,
    });
    if (parsed.accounts.ata.address !== expectedATA) {
      return { error: "ATA creation account does not match split recipient" };
    }

    instructionIndexes.add(index);
    const allowedFeePayerAccountIndexes = new Set<number>();
    if (parsed.accounts.payer.address === feePayerAddress) {
      allowedFeePayerAccountIndexes.add(0);
    }
    if (parsed.accounts.owner.address === feePayerAddress) {
      allowedFeePayerAccountIndexes.add(2);
    }
    if (allowedFeePayerAccountIndexes.size > 0) {
      allowedFeePayerAccountIndexesByInstructionIndex.set(
        index,
        allowedFeePayerAccountIndexes,
      );
    }

    const existingIndexes = creationIndexesByOwner.get(owner);
    if (existingIndexes) {
      existingIndexes.push(index);
    } else {
      creationIndexesByOwner.set(owner, [index]);
    }
  }

  for (const recipient of requiredSplitRecipients) {
    if (!creationIndexesByOwner.has(recipient)) {
      return { error: "missing required ATA creation instruction" };
    }
  }

  return {
    allowedFeePayerAccountIndexesByInstructionIndex,
    creationIndexesByOwner,
    instructionIndexes,
  };
}

async function findMatchingTokenTransfer(args: {
  amount: bigint;
  instructions: readonly Instruction[];
  matchedInstructionIndexes: Set<number>;
  md: mppChargeRequest["methodDetails"];
  recipient: string;
  request: mppChargeRequest;
  tokenProgram: Address;
}) {
  const {
    amount,
    instructions,
    matchedInstructionIndexes,
    md,
    recipient,
    request,
    tokenProgram,
  } = args;

  const [expectedATA] = await findAssociatedTokenPda({
    mint: address(request.currency),
    owner: address(recipient),
    tokenProgram,
  });

  for (const [index, ix] of instructions.entries()) {
    if (matchedInstructionIndexes.has(index)) continue;
    if (!ix.data || !ix.accounts) continue;
    if (ix.accounts.length !== 4) continue;
    if (ix.programAddress !== tokenProgram) continue;

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

    if (transfer.data.discriminator !== TRANSFER_CHECKED_DISCRIMINATOR) {
      continue;
    }

    if (transfer.data.amount !== amount) {
      logger.debug("transfer amount mismatch", {
        expected: amount.toString(),
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

    matchedInstructionIndexes.add(index);
    return {
      index,
      payer: transfer.accounts.authority.address,
      source: transfer.accounts.source.address,
    };
  }

  return { error: "no matching transferChecked instruction found" };
}

function findMatchingNativeTransfer(args: {
  amount: bigint;
  feePayerAddress: string;
  instructions: readonly Instruction[];
  matchedInstructionIndexes: Set<number>;
  recipient: string;
}) {
  const {
    amount,
    feePayerAddress,
    instructions,
    matchedInstructionIndexes,
    recipient,
  } = args;
  const expectedRecipient = address(recipient);

  for (const [index, ix] of instructions.entries()) {
    if (matchedInstructionIndexes.has(index)) continue;
    if (!ix.data || !ix.accounts) continue;
    if (ix.accounts.length !== 2) continue;
    if (ix.programAddress !== SYSTEM_PROGRAM_ADDRESS) continue;

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

    if (transfer.data.discriminator !== TRANSFER_SOL_DISCRIMINATOR) {
      continue;
    }

    if (transfer.data.amount !== amount) {
      logger.debug("native transfer amount mismatch", {
        expected: amount.toString(),
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

    matchedInstructionIndexes.add(index);
    return { index, payer: transfer.accounts.source.address };
  }

  return { error: "no matching transferSol instruction found" };
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

  const memoResult = verifyExpectedMemos(instructions, request);
  if (memoResult) return memoResult;

  const splitATAResult = await verifySplitATAInstructions({
    feePayerAddress,
    instructions,
    request,
    tokenProgram,
    transactionFeePayer: transactionMessage.feePayer.address,
  });
  if ("error" in splitATAResult) return splitATAResult;

  const feePayerResult = verifyFeePayerNotUsedByInstructions(
    instructions,
    feePayerAddress,
    (_instruction, _account, accountIndex, instructionIndex) => {
      return (
        splitATAResult.allowedFeePayerAccountIndexesByInstructionIndex
          .get(instructionIndex)
          ?.has(accountIndex) === true
      );
    },
  );
  if (feePayerResult) return feePayerResult;

  const primaryAmount = getPrimaryAmountResult(request);
  if ("error" in primaryAmount) return primaryAmount;

  const feePayerTokenAccount =
    feePayerAddress !== ""
      ? (
          await findAssociatedTokenPda({
            mint: address(request.currency),
            owner: address(feePayerAddress),
            tokenProgram,
          })
        )[0]
      : undefined;

  const matchedInstructionIndexes = new Set<number>();
  const primaryTransfer = await findMatchingTokenTransfer({
    amount: primaryAmount.amount,
    instructions,
    matchedInstructionIndexes,
    md,
    recipient: request.recipient,
    request,
    tokenProgram,
  });
  if ("error" in primaryTransfer) return primaryTransfer;

  if (primaryTransfer.payer === feePayerAddress) {
    return { error: "transfer authority must not be the fee payer" };
  }
  if (primaryTransfer.source === feePayerTokenAccount) {
    return { error: "transfer source must not be the fee payer" };
  }

  for (const split of getChargeSplits(request)) {
    const splitTransfer = await findMatchingTokenTransfer({
      amount: BigInt(split.amount),
      instructions,
      matchedInstructionIndexes,
      md,
      recipient: split.recipient,
      request,
      tokenProgram,
    });
    if ("error" in splitTransfer) return splitTransfer;
    if (splitTransfer.payer === feePayerAddress) {
      return { error: "transfer authority must not be the fee payer" };
    }
    if (splitTransfer.source === feePayerTokenAccount) {
      return { error: "transfer source must not be the fee payer" };
    }
    if (splitTransfer.payer !== primaryTransfer.payer) {
      return { error: "split transfer payer must match primary payer" };
    }
    if (split.ataCreationRequired === true) {
      const creationIndexes = splitATAResult.creationIndexesByOwner.get(
        address(split.recipient),
      );
      if (!creationIndexes?.some((index) => index < splitTransfer.index)) {
        return {
          error:
            "required ATA creation instruction must precede split transfer",
        };
      }
    }
  }

  const allowedInstructionIndexes = new Set<number>([
    ...matchedInstructionIndexes,
    ...splitATAResult.instructionIndexes,
  ]);
  const unexpectedInstructionResult = verifyNoUnexpectedInstructions({
    allowedInstructionIndexes,
    instructions,
  });
  if (unexpectedInstructionResult) return unexpectedInstructionResult;

  return { payer: primaryTransfer.payer };
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

  const memoResult = verifyExpectedMemos(instructions, request);
  if (memoResult) return memoResult;

  if (chargeHasATACreationSplits(request)) {
    return { error: "ataCreationRequired requires an SPL token charge" };
  }

  const primaryAmount = getPrimaryAmountResult(request);
  if ("error" in primaryAmount) return primaryAmount;

  const expectedTransfers = [
    { amount: primaryAmount.amount, recipient: request.recipient },
    ...getChargeSplits(request).map((split) => ({
      amount: BigInt(split.amount),
      recipient: split.recipient,
    })),
  ];

  const feePayerResult = verifyFeePayerNotUsedByInstructions(
    instructions,
    feePayerAddress,
    (ix, _account, index) => {
      // account index 1 is the transferSol destination: the fee payer may
      // receive a payout here, but must never be a transfer source.
      if (
        index !== 1 ||
        !ix.data ||
        !ix.accounts ||
        ix.accounts.length !== 2 ||
        ix.programAddress !== SYSTEM_PROGRAM_ADDRESS
      ) {
        return false;
      }

      try {
        const transfer = parseTransferSolInstruction({
          accounts: ix.accounts,
          programAddress: ix.programAddress,
          data: new Uint8Array(ix.data),
        });
        return (
          transfer.data.discriminator === TRANSFER_SOL_DISCRIMINATOR &&
          transfer.accounts.source.address !== feePayerAddress &&
          expectedTransfers.some(
            (expectedTransfer) =>
              transfer.accounts.destination.address ===
                address(expectedTransfer.recipient) &&
              transfer.data.amount === expectedTransfer.amount,
          )
        );
      } catch {
        return false;
      }
    },
  );
  if (feePayerResult) return feePayerResult;

  const matchedInstructionIndexes = new Set<number>();
  const primaryTransfer = findMatchingNativeTransfer({
    amount: primaryAmount.amount,
    feePayerAddress,
    instructions,
    matchedInstructionIndexes,
    recipient: request.recipient,
  });
  if ("error" in primaryTransfer) return primaryTransfer;

  for (const split of getChargeSplits(request)) {
    const splitTransfer = findMatchingNativeTransfer({
      amount: BigInt(split.amount),
      feePayerAddress,
      instructions,
      matchedInstructionIndexes,
      recipient: split.recipient,
    });
    if ("error" in splitTransfer) return splitTransfer;
    if (splitTransfer.payer !== primaryTransfer.payer) {
      return { error: "split transfer payer must match primary payer" };
    }
  }

  const unexpectedInstructionResult = verifyNoUnexpectedInstructions({
    allowedInstructionIndexes: matchedInstructionIndexes,
    instructions,
  });
  if (unexpectedInstructionResult) return unexpectedInstructionResult;

  return { payer: primaryTransfer.payer };
}
