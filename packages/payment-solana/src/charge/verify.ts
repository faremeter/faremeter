import {
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { parseTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  parseTransferCheckedInstruction,
} from "@solana-program/token";
import { address, type Address, type Instruction } from "@solana/kit";
import type { mppChargeRequest } from "./common";
import type { CompilableTransactionMessage } from "../common";
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

/** Inner instruction as returned by Solana RPC getTransaction (jsonParsed). */
export type RpcInnerInstruction = {
  programIdIndex: number;
  accounts: readonly number[];
  data: string; // base58-encoded
};

export type RpcInnerInstructionGroup = {
  index: number;
  instructions: ReadonlyArray<RpcInnerInstruction>;
};

export type VerifyChargeTransactionArgs = {
  transactionMessage: CompilableTransactionMessage;
  request: mppChargeRequest;
  feePayerAddress: string;
  tokenProgram: Address;
  maxPriorityFee?: number;
  /** CPI inner instructions from the on-chain transaction meta (push mode). */
  innerInstructions?: ReadonlyArray<RpcInnerInstructionGroup> | undefined;
  /** Static account keys from the on-chain transaction message. */
  staticAccountKeys?: readonly string[] | undefined;
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

  // Path 2: CPI inner instruction fallback for smart wallets (Squads,
  // Crossmint, SWIG). Smart wallets wrap SPL transfers inside a program
  // call, so the TransferChecked lives in inner instructions, not at the
  // top level. This follows the same pattern as x-solana-settlement.
  if (args.innerInstructions && args.staticAccountKeys) {
    const result = findTransferInInnerInstructions(
      args.innerInstructions,
      args.staticAccountKeys,
      request,
      expectedATA,
      feePayerAddress,
      tokenProgram,
    );
    if (result) return result;
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

// ---------------------------------------------------------------------------
// CPI inner instruction scanning for smart wallets
// ---------------------------------------------------------------------------
//
// Smart wallets (Squads, Crossmint, SWIG) route SPL token transfers through
// a CPI: the top-level instruction invokes the smart wallet program, which
// then calls SPL Token's TransferChecked as an inner instruction. This
// function scans inner instructions from the on-chain transaction meta
// when the top-level scan finds no match.
//
// This follows the same approach used by @faremeter/x-solana-settlement
// in its isValidTransferTransaction / extractTransferData functions.
// ---------------------------------------------------------------------------

// SPL Token program IDs that may host TransferChecked instructions.
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;

// TransferChecked instruction discriminator (byte 0 = 12).
const TRANSFER_CHECKED_DISCRIMINATOR = 12;

function findTransferInInnerInstructions(
  innerInstructions: ReadonlyArray<RpcInnerInstructionGroup>,
  staticAccountKeys: readonly string[],
  request: mppChargeRequest,
  expectedATA: Address,
  feePayerAddress: string,
  tokenProgram: Address,
): { payer: string } | { error: string } | null {
  let found: { payer: string } | null = null;

  for (const group of innerInstructions) {
    for (const ix of group.instructions) {
      // Resolve program ID from the static account keys.
      const programId = staticAccountKeys[ix.programIdIndex];
      if (!programId) continue;

      // Only inspect SPL Token or Token-2022 programs.
      if (programId !== SPL_TOKEN_PROGRAM && programId !== SPL_TOKEN_2022_PROGRAM) {
        continue;
      }

      // Decode base58 instruction data.
      let data: Uint8Array;
      try {
        data = decodeBase58(ix.data);
      } catch {
        continue;
      }

      // TransferChecked: discriminator 12, minimum 10 bytes (1 + 8 + 1).
      if (data.length < 10 || data[0] !== TRANSFER_CHECKED_DISCRIMINATOR) {
        continue;
      }

      // Parse amount (u64 LE bytes 1-8) and decimals (byte 9).
      const amount = readU64LE(data, 1);

      // Resolve account keys: source(0), mint(1), destination(2), authority(3).
      if (ix.accounts.length < 4) continue;
      const mintIdx = ix.accounts[1];
      const destIdx = ix.accounts[2];
      const authIdx = ix.accounts[3];
      if (mintIdx === undefined || destIdx === undefined || authIdx === undefined) continue;
      const mint = staticAccountKeys[mintIdx];
      const destination = staticAccountKeys[destIdx];
      const authority = staticAccountKeys[authIdx];
      if (!mint || !destination || !authority) continue;

      // Validate mint matches expected asset.
      if (mint !== request.currency) {
        logger.debug("CPI inner: mint mismatch", { expected: request.currency, actual: mint });
        continue;
      }

      // Validate destination is the correct ATA.
      if (destination !== expectedATA) {
        logger.debug("CPI inner: destination mismatch", { expected: expectedATA, actual: destination });
        continue;
      }

      // Validate amount matches requirements.
      if (amount !== BigInt(request.amount)) {
        logger.debug("CPI inner: amount mismatch", {
          expected: request.amount,
          actual: amount.toString(),
        });
        continue;
      }

      // Security: authority must not be the fee payer.
      if (authority === feePayerAddress) {
        return { error: "CPI inner transfer authority must not be the fee payer" };
      }

      // Ensure exactly one matching TransferChecked (reject duplicates).
      if (found !== null) {
        return { error: "multiple matching CPI inner transfers found" };
      }

      logger.info("CPI inner instruction: found TransferChecked (smart wallet path)", {
        authority,
        mint,
        destination,
        amount: amount.toString(),
      });

      found = { payer: authority };
    }
  }

  return found;
}

// Decode a base58-encoded string to Uint8Array.
function decodeBase58(encoded: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const BASE = BigInt(58);
  let num = 0n;
  for (const char of encoded) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`invalid base58 character: ${char}`);
    num = num * BASE + BigInt(idx);
  }
  const hex = num.toString(16).padStart(2, "0");
  const bytes = new Uint8Array(hex.length / 2 + (hex.length % 2));
  const padded = hex.length % 2 ? "0" + hex : hex;
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  // Preserve leading zeros (base58 leading '1's = leading 0x00 bytes).
  let leadingZeros = 0;
  for (const c of encoded) {
    if (c !== "1") break;
    leadingZeros++;
  }
  if (leadingZeros > 0) {
    const result = new Uint8Array(leadingZeros + bytes.length);
    result.set(bytes, leadingZeros);
    return result;
  }
  return bytes;
}

// Read a little-endian u64 from a Uint8Array at the given offset.
function readU64LE(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(data[offset + i] ?? 0) << BigInt(i * 8);
  }
  return value;
}
