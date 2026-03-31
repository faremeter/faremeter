import {
  JSONPATH_REF,
  findJSONSizeRefs,
} from "@faremeter/middleware-openapi/expr";
import type { FieldRef, PricingMode } from "./types.js";

const RESPONSE_PREFIX = "$.response.";

type AnalyzedRule = {
  match: string;
  authorize?: string | undefined;
  capture: string;
};

export type AnalysisResult = {
  pricingMode: PricingMode;
  captureFields: FieldRef[];
};

const HEADERS_PREFIX_DOT = "$.response.headers.";
const HEADERS_PREFIX_BRACKET = "$.response.headers[";
const STATUS_PATH = "$.response.status";

function classifyRef(path: string): FieldRef["source"] {
  if (
    path.startsWith(HEADERS_PREFIX_DOT) ||
    path.startsWith(HEADERS_PREFIX_BRACKET)
  ) {
    return "headers";
  }
  if (path === STATUS_PATH) return "status";
  return "body";
}

const BODY_PREFIX_DOT = "$.response.body.";
const BODY_PREFIX_BRACKET = "$.response.body[";

/**
 * Split the body-path portion of a `$.response.body...` JSONPath into
 * a list of segments for conflict-detection purposes. Handles dot
 * notation, single-quoted bracket notation, and numeric bracket
 * indices. Returns an empty array for refs that are not body paths
 * (the regex extractor in `@faremeter/middleware-openapi/expr`
 * guarantees only well-formed refs reach us, so no syntax validation
 * is needed here).
 */
function splitBodyPathSegments(ref: string): string[] {
  let remainder: string;
  if (ref.startsWith(BODY_PREFIX_DOT)) {
    remainder = ref.slice(BODY_PREFIX_DOT.length);
  } else if (ref.startsWith(BODY_PREFIX_BRACKET)) {
    remainder = ref.slice("$.response.body".length);
  } else {
    return [];
  }

  const segments: string[] = [];
  let i = 0;
  while (i < remainder.length) {
    if (remainder[i] === "[") {
      if (remainder[i + 1] === "'") {
        const close = remainder.indexOf("']", i + 2);
        if (close === -1) break;
        segments.push(remainder.slice(i + 2, close));
        i = close + 2;
      } else {
        const close = remainder.indexOf("]", i + 1);
        if (close === -1) break;
        segments.push(remainder.slice(i + 1, close));
        i = close + 1;
      }
      if (remainder[i] === ".") i++;
    } else {
      let end = i;
      while (
        end < remainder.length &&
        remainder[end] !== "." &&
        remainder[end] !== "["
      ) {
        end++;
      }
      if (end === i) break;
      segments.push(remainder.slice(i, end));
      i = end;
      if (remainder[i] === ".") i++;
    }
  }
  return segments;
}

/**
 * Reject capture specs that would produce ambiguous Lua capture
 * reconstruction. A leaf-vs-subtree conflict is e.g. capturing both
 * `$.response.body.usage` (as a whole subtree) and
 * `$.response.body.usage.total_tokens` (as a specific leaf inside it
 * — the Lua reconstructor would silently emit one or the other
 * depending on iteration order). Spec authors get a specific pointer
 * at the two conflicting paths at config-generation time instead of
 * surprising runtime behavior.
 *
 * Header- and status-sourced fields are exempt because header and
 * status values never nest.
 */
function validateCapturePathConflicts(fields: FieldRef[]): void {
  const bodyPaths: { path: string; segments: string[] }[] = [];
  for (const field of fields) {
    if (field.source !== "body") continue;
    bodyPaths.push({
      path: field.path,
      segments: splitBodyPathSegments(field.path),
    });
  }

  for (let i = 0; i < bodyPaths.length; i++) {
    const a = bodyPaths[i];
    if (!a) continue;
    for (let j = i + 1; j < bodyPaths.length; j++) {
      const b = bodyPaths[j];
      if (!b) continue;
      if (a.segments.length === b.segments.length) continue;
      const [shorter, longer] =
        a.segments.length < b.segments.length ? [a, b] : [b, a];
      let isPrefix = true;
      for (let k = 0; k < shorter.segments.length; k++) {
        if (shorter.segments[k] !== longer.segments[k]) {
          isPrefix = false;
          break;
        }
      }
      if (isPrefix) {
        throw new Error(
          `analyzeRule: capture paths conflict — ${JSON.stringify(shorter.path)} ` +
            `is captured as a leaf but ${JSON.stringify(longer.path)} captures a ` +
            `deeper field within the same subtree. A path cannot be both a leaf ` +
            `and a subtree parent.`,
        );
      }
    }
  }
}

/**
 * Return every `$.response.*` JSONPath reference appearing in a pricing
 * expression, in source order (duplicates preserved — deduplication is
 * {@link analyzeRule}'s responsibility). The Lua capture layer only
 * needs to know *which* paths to extract from the response; whether a
 * ref sits in a coalesce primary, fallback, or bare position is
 * irrelevant at extraction time because all extractions are already
 * nil-tolerant.
 *
 * Also rejects refs whose path continues into unsupported JSONPath
 * syntax (wildcards `[*]`, named indices, filter expressions). The
 * shared ref regex stops at the first unsupported character and
 * returns the valid prefix; without this check, a capture like
 * `$.response.body.items[*].count` would silently capture the whole
 * `items` array instead of the per-item counts the author asked for.
 */
function extractResponseRefs(expression: string): string[] {
  const refs: string[] = [];
  const re = new RegExp(JSONPATH_REF.source, JSONPATH_REF.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    const ref = m[0];
    const end = m.index + ref.length;
    const next = expression[end];
    // If the next char is `[` or `.` or an identifier-like char,
    // the ref regex truncated the ref mid-path at an unsupported
    // continuation. `.` after a valid ref would already have been
    // consumed by the regex, so a leftover `.` implies a
    // double-dot or similar malformed input; `[` implies a
    // wildcard or filter bracket.
    if (next === "[" || next === ".") {
      throw new Error(
        `analyzeRule: unsupported JSONPath syntax after ${JSON.stringify(ref)} ` +
          `in expression ${JSON.stringify(expression)} — wildcards, filters, ` +
          `and named indices are not supported by the Lua extraction layer`,
      );
    }
    if (ref.startsWith(RESPONSE_PREFIX)) {
      refs.push(ref);
    }
  }
  return refs;
}

function detectJsonSizeOnResponse(expression: string): string | null {
  for (const ref of findJSONSizeRefs(expression)) {
    if (ref.startsWith("$.response.")) return ref;
  }
  return null;
}

export function analyzeRule(rule: AnalyzedRule): AnalysisResult {
  const pricingMode: PricingMode = rule.authorize ? "two-phase" : "one-phase";

  const jsonSizeRef = detectJsonSizeOnResponse(rule.capture);
  if (jsonSizeRef) {
    throw new Error(
      `jsonSize(${jsonSizeRef}) is not supported in capture expressions; ` +
        `response body size is not available at the nginx extraction layer`,
    );
  }

  const responseRefs = extractResponseRefs(rule.capture);

  // One-phase capture-only rules (no authorize) can reference response data
  // to meter usage after the fact without gating the request.

  const seen = new Set<string>();
  const captureFields: FieldRef[] = [];
  for (const ref of responseRefs) {
    if (seen.has(ref)) continue;
    seen.add(ref);

    // Reject bare `$.response.body` (no field suffix) at the
    // analyzer layer with a clear error. Without this up-front
    // check the spec still gets rejected — but later, by the
    // `bodyFieldPath` helper during Lua-file generation, with an
    // error message that names an internal helper. Surfacing it
    // here gives the spec author a direct pointer at the bad path.
    if (ref === "$.response.body") {
      throw new Error(
        `analyzeRule: capture path ${JSON.stringify(ref)} must reference a ` +
          `specific field within the response body (e.g. ` +
          `$.response.body.usage.total_tokens), not the body as a whole`,
      );
    }

    captureFields.push({
      path: ref,
      source: classifyRef(ref),
    });
  }

  validateCapturePathConflicts(captureFields);

  return {
    pricingMode,
    captureFields,
  };
}

export { extractResponseRefs };
