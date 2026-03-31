import {
  loadSpec as loadFaremeterSpec,
  extractSpec as extractFaremeterSpec,
} from "@faremeter/middleware-openapi";
import type { FaremeterSpec } from "@faremeter/middleware-openapi";
import type { RouteConfig } from "./types.js";
import { analyzeRule } from "./analyzer.js";

export type ParsedSpec = {
  routes: RouteConfig[];
};

function ratesToStrings(rates: Record<string, bigint>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rates)) {
    result[key] = value.toString();
  }
  return result;
}

/**
 * Transform a validated FaremeterSpec into nginx route configs.
 *
 * Pure, does no I/O. Callers obtain the spec via
 * {@link loadGatewaySpec} / {@link extractGatewaySpec}, or via the
 * lower-level `loadSpec` / `extractSpec` in
 * `@faremeter/middleware-openapi`.
 */
export function specToRoutes(spec: FaremeterSpec): RouteConfig[] {
  const routes: RouteConfig[] = [];
  for (const op of Object.values(spec.operations)) {
    const rules = op.rules ?? [];
    if (rules.length === 0) continue;

    const captureFields: RouteConfig["captureFields"] = [];
    const seen = new Set<string>();
    let pricingMode: RouteConfig["pricingMode"] = "one-phase";
    for (const rule of rules) {
      const analysis = analyzeRule(rule);
      if (analysis.pricingMode === "two-phase") pricingMode = "two-phase";
      for (const field of analysis.captureFields) {
        if (seen.has(field.path)) continue;
        seen.add(field.path);
        captureFields.push(field);
      }
    }

    routes.push({
      path: op.path,
      method: op.method,
      pricingRules: ratesToStrings(op.rates ?? {}),
      transportType: op.transport,
      pricingMode,
      captureFields,
    });
  }
  return routes;
}

/**
 * Load and parse an OpenAPI spec file into an nginx-ready route set.
 */
export async function loadGatewaySpec(filePath: string): Promise<ParsedSpec> {
  const spec = await loadFaremeterSpec(filePath);
  return toParsedSpec(spec);
}

/**
 * Convert an already-dereferenced OpenAPI document into an nginx-ready route
 * set. Runs the same validation as {@link loadGatewaySpec}.
 */
export function extractGatewaySpec(doc: Record<string, unknown>): ParsedSpec {
  const spec = extractFaremeterSpec(doc);
  return toParsedSpec(spec);
}

function toParsedSpec(spec: FaremeterSpec): ParsedSpec {
  const routes = specToRoutes(spec);
  return { routes };
}
