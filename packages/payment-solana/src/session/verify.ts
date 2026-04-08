import type { Address } from "@solana/kit";
import { canonicalizeSortedJSON } from "@faremeter/types/mpp";
import {
  serializePaymentAuthorization,
  type SplitInput,
} from "@faremeter/flex-solana";

/**
 * Serializes spec-shaped voucher data per draft-solana-session-00
 * §"Voucher Signing": JCS canonicalization of the voucher data object,
 * UTF-8 encoded.
 */
export function serializeSpecVoucherMessage(args: {
  channelId: string;
  cumulativeAmount: string;
  expiresAt?: string;
}): Uint8Array<ArrayBuffer> {
  const data: Record<string, unknown> = {
    channelId: args.channelId,
    cumulativeAmount: args.cumulativeAmount,
  };
  if (args.expiresAt !== undefined) data.expiresAt = args.expiresAt;
  const json = canonicalizeSortedJSON(data);
  const encoded = new TextEncoder().encode(json);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}

export type VoucherSplit = SplitInput;

export type SerializeVoucherArgs = {
  programAddress: Address;
  escrow: Address;
  mint: Address;
  maxAmount: bigint;
  authorizationId: bigint;
  expiresAtSlot: bigint;
  splits: VoucherSplit[];
};

/**
 * Serializes a Flex payment authorization into the binary format the
 * on-chain program's Ed25519 precompile verifies. This is a thin
 * adapter over `@faremeter/flex-solana`'s
 * `serializePaymentAuthorization` so the session handler can keep its
 * own argument shape (`programAddress` rather than `programId`).
 */
export function serializeVoucherMessage(
  args: SerializeVoucherArgs,
): Uint8Array<ArrayBuffer> {
  return serializePaymentAuthorization({
    programId: args.programAddress,
    escrow: args.escrow,
    mint: args.mint,
    maxAmount: args.maxAmount,
    authorizationId: args.authorizationId,
    expiresAtSlot: args.expiresAtSlot,
    splits: args.splits,
  });
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verifies an Ed25519 signature over a voucher message using the
 * Web Crypto API. Returns true on a valid signature, false otherwise.
 * Raw key is imported as SPKI after wrapping with the Ed25519 OID
 * header.
 */
function toArrayBufferUint8(input: Uint8Array): Uint8Array<ArrayBuffer> {
  if (input.buffer instanceof ArrayBuffer && input.byteOffset === 0) {
    return input as Uint8Array<ArrayBuffer>;
  }
  const out = new Uint8Array(new ArrayBuffer(input.length));
  out.set(input);
  return out;
}

export async function verifyVoucherSignature(args: {
  publicKey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
}): Promise<boolean> {
  const publicKey = toArrayBufferUint8(args.publicKey);
  const message = toArrayBufferUint8(args.message);
  const signature = toArrayBufferUint8(args.signature);
  const spki = wrapEd25519SPKI(publicKey);
  const key = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("Ed25519", key, signature, message);
}

// Ed25519 SPKI header (DER): SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING }
const ED25519_SPKI_HEADER = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function wrapEd25519SPKI(
  rawPublicKey: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (rawPublicKey.length !== 32) {
    throw new Error(
      `ed25519 public key must be 32 bytes, got ${rawPublicKey.length}`,
    );
  }
  const out = new Uint8Array(new ArrayBuffer(ED25519_SPKI_HEADER.length + 32));
  out.set(ED25519_SPKI_HEADER, 0);
  out.set(rawPublicKey, ED25519_SPKI_HEADER.length);
  return out;
}

export function base64ToVoucherParts(b64: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(b64);
}
