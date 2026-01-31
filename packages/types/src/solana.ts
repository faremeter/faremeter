import { type } from "arktype";
import { isValidationError } from "./validation";

/**
 * Validator for Solana base58-encoded addresses.
 */
export const Base58Address = type(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export type Base58Address = typeof Base58Address.infer;

/**
 * Type guard that checks if a value is a valid Solana base58 address.
 *
 * @param maybe - The value to check
 * @returns True if the value matches the base58 address format
 */
export function isBaseAddress(maybe: unknown): maybe is Base58Address {
  return !isValidationError(Base58Address(maybe));
}
