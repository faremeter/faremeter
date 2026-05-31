import { type } from "arktype";
import { address, getBase58Encoder, getBase64Encoder } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { TOKEN_2022_PROGRAM_ADDRESS } from "../splToken";

export const SOLANA_CHARGE_MAX_SPLITS = 8;
export const SOLANA_MEMO_MAX_BYTES = 566;
export const SOLANA_CHARGE_CURRENCY_MAX_LENGTH = 128;
export const SOLANA_CHARGE_DESCRIPTION_MAX_LENGTH = 256;
export const SOLANA_CHARGE_TRANSACTION_MAX_BYTES = 1232;

const SOLANA_U64_MAX = "18446744073709551615";
const SOLANA_NATIVE_CURRENCY = "sol";
const SOLANA_CHARGE_DECIMALS_MIN = 0;
const SOLANA_CHARGE_DECIMALS_MAX = 9;
const SOLANA_TOKEN_PROGRAMS = new Set<string>([
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
]);

const memoEncoder = new TextEncoder();
const base58Encoder = getBase58Encoder();
const base64Encoder = getBase64Encoder();

const solanaAtomicAmount = type(/^[1-9][0-9]*$/).pipe.try((amount) => {
  if (!isUint64Amount(amount)) {
    throw new Error("amount must fit in uint64");
  }
  return amount;
});
const solanaChargeSplit = type({
  recipient: "string",
  amount: solanaAtomicAmount,
  "ataCreationRequired?": "boolean",
  "memo?": "string",
});

const solanaSignature = type("string").pipe.try((signature) => {
  let bytes;
  try {
    bytes = base58Encoder.encode(signature);
  } catch {
    throw new Error("signature must be base58 encoded");
  }

  if (bytes.byteLength !== 64) {
    throw new Error("signature must decode to 64 bytes");
  }
  return signature;
});

const solanaWireTransaction = type("string").pipe.try((transaction) => {
  let bytes;
  try {
    bytes = base64Encoder.encode(transaction);
  } catch {
    throw new Error("transaction must be base64 encoded");
  }

  if (bytes.byteLength === 0) {
    throw new Error("transaction must not be empty");
  }
  if (bytes.byteLength > SOLANA_CHARGE_TRANSACTION_MAX_BYTES) {
    throw new Error(
      `transaction exceeds ${SOLANA_CHARGE_TRANSACTION_MAX_BYTES} bytes`,
    );
  }
  return transaction;
});

export const solanaChargeMethodDetails = type({
  "network?": "string",
  "decimals?": "number",
  "tokenProgram?": "string",
  "feePayer?": "boolean",
  "feePayerKey?": "string",
  "recentBlockhash?": "string",
  "splits?": solanaChargeSplit.array().atMostLength(SOLANA_CHARGE_MAX_SPLITS),
});

export type solanaChargeMethodDetails = typeof solanaChargeMethodDetails.infer;

const mppChargeRequestShape = type({
  amount: solanaAtomicAmount,
  currency: "string",
  recipient: "string",
  "description?": "string",
  "externalId?": "string",
  "methodDetails?": solanaChargeMethodDetails,
});

type MPPChargeRequestShape = typeof mppChargeRequestShape.infer;

export const mppChargeRequest = mppChargeRequestShape.pipe.try((request) => {
  const error = getChargeRequestValidationError(request);
  if (error) throw new Error(error);
  return request;
});

export type mppChargeRequest = typeof mppChargeRequest.infer;

export function getChargeSplits(request: mppChargeRequest) {
  return request.methodDetails?.splits ?? [];
}

export function chargeHasATACreationSplits(request: mppChargeRequest): boolean {
  return getChargeSplits(request).some(
    (split) => split.ataCreationRequired === true,
  );
}

export function getChargePrimaryAmount(request: mppChargeRequest): bigint {
  const amount = BigInt(request.amount);
  const splitsTotal = getChargeSplits(request).reduce(
    (sum, split) => sum + BigInt(split.amount),
    0n,
  );
  const primaryAmount = amount - splitsTotal;
  if (primaryAmount <= 0n) {
    throw new Error("splits consume the entire amount");
  }
  return primaryAmount;
}

export function getChargeChallengeMemo(
  request: mppChargeRequest,
): string | undefined {
  return request.externalId;
}

export function getChargeMemoValidationError(memo: string): string | null {
  if (memoEncoder.encode(memo).byteLength > SOLANA_MEMO_MAX_BYTES) {
    return `Memo exceeds ${SOLANA_MEMO_MAX_BYTES} bytes`;
  }
  return null;
}

export function getChargeRequestMemoValidationError(
  request: mppChargeRequest,
): string | null {
  const challengeMemo = request.externalId;
  if (challengeMemo !== undefined && challengeMemo.length > 0) {
    const error = getChargeMemoValidationError(challengeMemo);
    if (error) return error;
  }

  for (const split of request.methodDetails?.splits ?? []) {
    if (split.memo !== undefined && split.memo.length > 0) {
      const error = getChargeMemoValidationError(split.memo);
      if (error) return error;
    }
  }

  return null;
}

function getChargeRequestValidationError(
  request: MPPChargeRequestShape,
): string | null {
  if (!isUint64Amount(request.amount)) {
    return "amount must be a positive uint64";
  }

  if (request.currency.length > SOLANA_CHARGE_CURRENCY_MAX_LENGTH) {
    return `currency exceeds ${SOLANA_CHARGE_CURRENCY_MAX_LENGTH} characters`;
  }

  const isNative = request.currency === SOLANA_NATIVE_CURRENCY;
  if (!isNative && !isSolanaAddress(request.currency)) {
    return "currency must be 'sol' or a base58 Solana address";
  }

  if (!isSolanaAddress(request.recipient)) {
    return "recipient must be a base58 Solana address";
  }

  if (
    request.description !== undefined &&
    request.description.length > SOLANA_CHARGE_DESCRIPTION_MAX_LENGTH
  ) {
    return `description exceeds ${SOLANA_CHARGE_DESCRIPTION_MAX_LENGTH} characters`;
  }

  const memoError = getChargeRequestMemoValidationError(request);
  if (memoError) return memoError;

  const methodDetails = request.methodDetails;
  const decimalsError = getDecimalsValidationError(methodDetails?.decimals);
  if (decimalsError) return decimalsError;

  if (isNative) {
    const nativeError = getNativeChargeValidationError(methodDetails);
    if (nativeError) return nativeError;
  } else {
    const tokenError = getTokenChargeValidationError(methodDetails);
    if (tokenError) return tokenError;
  }

  if (methodDetails?.feePayer === true) {
    if (methodDetails.feePayerKey === undefined) {
      return "feePayerKey is required when feePayer is true";
    }
    if (!isSolanaAddress(methodDetails.feePayerKey)) {
      return "feePayerKey must be a base58 Solana address";
    }
  } else if (methodDetails?.feePayerKey !== undefined) {
    return "feePayerKey must be absent unless feePayer is true";
  }

  let splitsTotal = 0n;
  for (const split of methodDetails?.splits ?? []) {
    if (!isSolanaAddress(split.recipient)) {
      return "split recipient must be a base58 Solana address";
    }
    splitsTotal += BigInt(split.amount);
  }

  if (splitsTotal >= BigInt(request.amount)) {
    return "splits consume the entire amount";
  }

  return null;
}

function getDecimalsValidationError(decimals: number | undefined) {
  if (decimals === undefined) return null;
  if (
    !Number.isInteger(decimals) ||
    decimals < SOLANA_CHARGE_DECIMALS_MIN ||
    decimals > SOLANA_CHARGE_DECIMALS_MAX
  ) {
    return `decimals must be an integer from ${SOLANA_CHARGE_DECIMALS_MIN} to ${SOLANA_CHARGE_DECIMALS_MAX}`;
  }
  return null;
}

function getNativeChargeValidationError(
  methodDetails: MPPChargeRequestShape["methodDetails"],
) {
  if (methodDetails?.decimals !== undefined) {
    return "decimals must be absent for SOL charges";
  }
  if (methodDetails?.tokenProgram !== undefined) {
    return "tokenProgram must be absent for SOL charges";
  }
  if (
    (methodDetails?.splits ?? []).some(
      (split) => split.ataCreationRequired === true,
    )
  ) {
    return "ataCreationRequired requires an SPL token charge";
  }
  return null;
}

function getTokenChargeValidationError(
  methodDetails: MPPChargeRequestShape["methodDetails"],
) {
  if (methodDetails?.decimals === undefined) {
    return "decimals is required for SPL token charges";
  }
  if (methodDetails.tokenProgram === undefined) return null;
  if (!isSolanaAddress(methodDetails.tokenProgram)) {
    return "tokenProgram must be a base58 Solana address";
  }
  if (!SOLANA_TOKEN_PROGRAMS.has(methodDetails.tokenProgram)) {
    return "tokenProgram must be the SPL Token or Token-2022 program";
  }
  return null;
}

function isSolanaAddress(value: string): boolean {
  try {
    address(value);
    return true;
  } catch {
    return false;
  }
}

function isUint64Amount(amount: string): boolean {
  return (
    amount.length < SOLANA_U64_MAX.length ||
    (amount.length === SOLANA_U64_MAX.length && amount <= SOLANA_U64_MAX)
  );
}

export const chargeCredentialPayload = type(
  {
    type: "'transaction'",
    transaction: solanaWireTransaction,
  },
  "|",
  {
    type: "'signature'",
    signature: solanaSignature,
  },
);

export type chargeCredentialPayload = typeof chargeCredentialPayload.infer;
