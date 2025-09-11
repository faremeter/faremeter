import { type } from "arktype";
import { isValidationError } from "./validation";

export const Base58Address = type(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export type Base58Address = typeof Base58Address.infer;

export function isBaseAddress(maybe: unknown): maybe is Base58Address {
  return !isValidationError(Base58Address(maybe));
}
