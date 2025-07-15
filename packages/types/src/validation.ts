import { type } from "arktype";

export function isValidationError<T>(
  possibleErrors: T | type.errors,
): possibleErrors is type.errors {
  return possibleErrors instanceof type.errors;
}

export function throwValidationError(
  message: string,
  errors: type.errors,
): never {
  throw new Error(message + ": " + errors.map((e) => e.message).join(","));
}
