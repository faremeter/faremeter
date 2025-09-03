import { type } from "arktype";

export function caseInsensitiveLiteral<T extends string>(l: T) {
  const literal = "'" + l.replaceAll("'", "\\'").toLowerCase() + "'";
  return type("string.lower").pipe(type(literal as type.cast<Lowercase<T>>));
}
