import { type } from "arktype";

export function caseInsensitiveLiteral<T extends string>(...l: T[]) {
  return type("string.lower").to(
    type.enumerated(...l.map((s) => s.toLowerCase())) as type.cast<
      Lowercase<T>
    >,
  );
}
