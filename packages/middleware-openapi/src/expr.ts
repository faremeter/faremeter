/**
 * Shared expression-parsing primitives used by both the runtime pricing
 * evaluator (`./evaluator`) and the static analyzer in
 * `@faremeter/gateway-nginx`. Keeping these in one place prevents the two
 * callers from drifting on regex shape or coalesce-parsing semantics.
 */

/**
 * Matches a JSONPath reference of the form `$.foo.bar`, `$['k']`, or
 * `$[0]` (and chains thereof). The `g` flag is required for
 * `String.prototype.replace` callback usage and for iterative `.exec`
 * scanning; callers using `.exec` must reset `lastIndex` themselves.
 */
export const JSONPATH_REF = /\$(?:\.[\w-]+|\['[^']*'\]|\[\d+\])+/g;

export type CoalesceMatch = {
  arg: string;
  fallback: string;
  start: number;
  end: number;
};

/**
 * True if `ch` is a character that can appear as part of a JS/expr-eval
 * identifier — letter, digit, underscore, or `$`. Used by
 * {@link extractCoalesce} to reject `coalesce(` matches whose left
 * neighbor is an identifier character (e.g. `mycoalesce(...)`), which
 * would otherwise be silently rewritten as a coalesce call.
 */
function isIdentChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f || // _
    code === 0x24 // $
  );
}

/**
 * Find the first `coalesce(arg, fallback)` call in `expr` and return its
 * argument, fallback, and span. Handles balanced parentheses and nested
 * function calls in either position. Returns `null` when no well-formed
 * coalesce is present.
 *
 * The scan enforces a left-boundary identifier check so that names
 * ending in `coalesce` (e.g. `mycoalesce`, `precoalesce`, `_coalesce`)
 * are NOT matched as coalesce calls. Without that check the inner
 * arguments would be silently rewritten, producing an expression that
 * evaluates to an unintended value instead of failing at parse time.
 */
export function extractCoalesce(expr: string): CoalesceMatch | null {
  const prefix = "coalesce(";
  let searchFrom = 0;
  for (;;) {
    const idx = expr.indexOf(prefix, searchFrom);
    if (idx === -1) return null;
    if (idx > 0 && isIdentChar(expr[idx - 1])) {
      // False positive: this `coalesce(` is the tail of a longer
      // identifier. Skip past the opening paren and keep looking.
      searchFrom = idx + prefix.length;
      continue;
    }

    const innerStart = idx + prefix.length;
    let depth = 1;
    let commaPos = -1;
    for (let i = innerStart; i < expr.length; i++) {
      if (expr[i] === "(") depth++;
      if (expr[i] === ")") depth--;
      if (depth === 1 && expr[i] === "," && commaPos === -1) commaPos = i;
      if (depth === 0) {
        if (commaPos === -1) return null;
        return {
          arg: expr.slice(innerStart, commaPos).trim(),
          fallback: expr.slice(commaPos + 1, i).trim(),
          start: idx,
          end: i + 1,
        };
      }
    }
    return null;
  }
}

/**
 * Find an *innermost* `coalesce(arg, fallback)` call in `expr`: one
 * whose arg and fallback contain no further `coalesce(` token and can
 * therefore be collapsed to a value without first resolving any other
 * coalesce. Callers that iteratively replace innermost-first are then
 * guaranteed that by the time an outer coalesce is processed, every
 * inner coalesce has already been reduced to a plain subexpression.
 *
 * The iterative "first coalesce in source order" walk used by
 * {@link extractCoalesce} is incorrect for nested coalesce because the
 * outer's `arg` contains the inner coalesce text verbatim — treating
 * that arg as a flat expression and extracting JSONPath refs from it
 * pulls refs out of the inner's *fallback* position, which then
 * incorrectly flip the outer to its fallback when any inner-fallback
 * ref is absent. Processing innermost-first avoids the confusion.
 */
export function findInnermostCoalesce(expr: string): CoalesceMatch | null {
  const prefix = "coalesce(";
  let cursor = 0;
  while (cursor < expr.length) {
    const sub = expr.slice(cursor);
    const match = extractCoalesce(sub);
    if (!match) return null;
    // Check for a *real* coalesce inside arg/fallback via the
    // boundary-aware {@link extractCoalesce} rather than plain
    // substring `.includes(prefix)` — the latter would false-positive
    // on identifiers like `mycoalesce(` and incorrectly classify a
    // genuine innermost coalesce as non-innermost.
    if (
      extractCoalesce(match.arg) === null &&
      extractCoalesce(match.fallback) === null
    ) {
      return {
        arg: match.arg,
        fallback: match.fallback,
        start: cursor + match.start,
        end: cursor + match.end,
      };
    }
    // This coalesce has a nested one somewhere in its arg or
    // fallback. Advance past the opening `coalesce(` token of the
    // current match and search again — the next match in source
    // order is guaranteed to be inside (or after) this coalesce.
    cursor = cursor + match.start + prefix.length;
  }
  return null;
}

/**
 * Return every JSONPath reference that appears in `expr`, in source
 * order. Uses a fresh `RegExp` instance so concurrent callers cannot
 * clobber each other's `lastIndex` via the shared `JSONPATH_REF`
 * constant.
 */
export function extractPlainRefs(expr: string): string[] {
  const refs: string[] = [];
  const re = new RegExp(JSONPATH_REF.source, JSONPATH_REF.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    refs.push(m[0]);
  }
  return refs;
}

/**
 * Return the JSONPath argument of every `jsonSize(...)` call in `expr`,
 * in source order. Builds its pattern from {@link JSONPATH_REF} so the
 * JSONPath shape has exactly one source of truth across the codebase.
 */
export function findJSONSizeRefs(expr: string): string[] {
  const re = new RegExp(
    String.raw`jsonSize\s*\(\s*(${JSONPATH_REF.source})\s*\)`,
    "g",
  );
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m[1] !== undefined) refs.push(m[1]);
  }
  return refs;
}
