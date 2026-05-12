import {
  loadSpec as loadFaremeterSpec,
  extractSpec as extractFaremeterSpec,
} from "@faremeter/middleware-openapi";
import type { LoadedSpec } from "@faremeter/middleware-openapi";
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
 * Transform a loaded OpenAPI spec into nginx route configs.
 *
 * Uses the spec's `defaultPricing` (the rules/rates extracted from
 * `x-faremeter-pricing` extensions) to drive nginx-level routing
 * decisions. The gateway-nginx layer needs a single canonical view
 * per operation; per-binding variations live above this layer in the
 * sidecar.
 *
 * Pure, does no I/O. Callers obtain the loaded spec via
 * {@link loadGatewaySpec} / {@link extractGatewaySpec}, or via the
 * lower-level `loadSpec` / `extractSpec` in
 * `@faremeter/middleware-openapi`.
 */
export function specToRoutes(loaded: LoadedSpec): RouteConfig[] {
  const routes: RouteConfig[] = [];
  for (const [opKey, op] of Object.entries(loaded.spec.operations)) {
    const pricing = loaded.defaultPricing[opKey];
    const rules = pricing?.rules ?? [];
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
      pricingRules: ratesToStrings(pricing?.rates ?? {}),
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
  const loaded = await loadFaremeterSpec(filePath);
  return toParsedSpec(loaded);
}

/**
 * Convert an already-dereferenced OpenAPI document into an nginx-ready route
 * set. Runs the same validation as {@link loadGatewaySpec}.
 */
export function extractGatewaySpec(doc: Record<string, unknown>): ParsedSpec {
  const loaded = extractFaremeterSpec(doc);
  return toParsedSpec(loaded);
}

function toParsedSpec(loaded: LoadedSpec): ParsedSpec {
  const routes = specToRoutes(loaded);
  return { routes };
}
