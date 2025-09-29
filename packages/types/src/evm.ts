import { type } from "arktype";
import { isValidationError } from "./validation";

export const Address = type(
  /^(0x)?[0-9a-fA-F]{40}$/ as type.cast<`0x${string}`>,
);
export type Address = typeof Address.infer;

export function isAddress(maybe: unknown): maybe is Address {
  return !isValidationError(Address(maybe));
}

export const PrivateKey = type(
  /^0x[0-9a-fA-F]{64}$/ as type.cast<`0x${string}`>,
);
export type PrivateKey = typeof Address.infer;

export function isPrivateKey(maybe: unknown): maybe is PrivateKey {
  return !isValidationError(PrivateKey(maybe));
}
