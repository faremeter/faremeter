import type { FieldRef, PricingMode } from "./types.js";

const JSONPATH_REF = /\$(?:\.[\w-]+|\['[^']*'\]|\[\d+\])+/g;

type CoalesceResult = {
  arg: string;
  fallback: string;
  start: number;
  end: number;
};

function extractCoalesce(expr: string): CoalesceResult | null {
  const prefix = "coalesce(";
  const idx = expr.indexOf(prefix);
  if (idx === -1) return null;

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

type AnalyzedRule = {
  match: string;
  authorize?: string | undefined;
  capture: string;
};

export type AnalysisResult = {
  pricingMode: PricingMode;
  captureFields: FieldRef[];
  reconstructionMap: Record<string, unknown>;
};

function classifyRef(path: string): FieldRef["source"] {
  if (path.startsWith("$.response.headers")) return "headers";
  if (path === "$.response.status") return "status";
  return "body";
}

function extractResponseRefs(
  expression: string,
): { ref: string; optional: boolean }[] {
  const results: { ref: string; optional: boolean }[] = [];

  let processed = expression;
  for (;;) {
    const coal = extractCoalesce(processed);
    if (!coal) break;

    const primaryRefs = extractPlainRefs(coal.arg);
    for (const ref of primaryRefs) {
      if (ref.startsWith("$.response.")) {
        results.push({ ref, optional: true });
      }
    }

    const fallbackRefs = extractPlainRefs(coal.fallback);
    for (const ref of fallbackRefs) {
      if (ref.startsWith("$.response.")) {
        results.push({ ref, optional: false });
      }
    }

    processed =
      processed.slice(0, coal.start) +
      `_placeholder` +
      processed.slice(coal.end);
  }

  const remainingRefs = extractPlainRefs(processed);
  for (const ref of remainingRefs) {
    if (ref.startsWith("$.response.")) {
      results.push({ ref, optional: false });
    }
  }

  return results;
}

function extractPlainRefs(expr: string): string[] {
  const refs: string[] = [];
  JSONPATH_REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSONPATH_REF.exec(expr)) !== null) {
    refs.push(m[0]);
  }
  return refs;
}

function detectJsonSizeOnResponse(expression: string): string | null {
  const pattern = /jsonSize\s*\(\s*(\$(?:\.[\w-]+|\['[^']*'\]|\[\d+\])+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(expression)) !== null) {
    const ref = m[1];
    if (ref?.startsWith("$.response.")) {
      return ref;
    }
  }
  return null;
}

function refToBodyPath(ref: string): string[] | null {
  const bodyPrefix = "$.response.body.";
  if (!ref.startsWith(bodyPrefix)) return null;
  return ref.slice(bodyPrefix.length).split(".");
}

function buildReconstructionMap(fields: FieldRef[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.source !== "body") continue;
    const segments = refToBodyPath(field.path);
    if (!segments) continue;

    let current: Record<string, unknown> = map;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      if (i === segments.length - 1) {
        current[seg] = true;
      } else {
        if (!(seg in current) || typeof current[seg] !== "object") {
          current[seg] = {};
        }
        current = current[seg] as Record<string, unknown>;
      }
    }
  }
  return map;
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
  for (const { ref, optional } of responseRefs) {
    if (seen.has(ref)) continue;
    seen.add(ref);

    captureFields.push({
      path: ref,
      source: classifyRef(ref),
      optional,
    });
  }

  const reconstructionMap = buildReconstructionMap(captureFields);

  return {
    pricingMode,
    captureFields,
    reconstructionMap,
  };
}

export { extractCoalesce, extractResponseRefs, buildReconstructionMap };
