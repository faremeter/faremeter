import { bundle } from "@scalar/json-magic/bundle";
import { readFiles } from "@scalar/json-magic/bundle/plugins/node";
import {
  parseYaml,
  parseJson,
} from "@scalar/json-magic/bundle/plugins/browser";
import { dereference } from "@scalar/openapi-parser";
import type { RouteConfig, TransportType } from "./types.js";
import { analyzeRule } from "./analyzer.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type Asset = {
  chain: string;
  token: string;
  decimals: number;
};

export type Rates = Record<string, number>;

export type PricingRule = {
  match: string;
  authorize?: string;
  capture: string;
};

export type ParsedSpec = {
  assets: Record<string, Asset>;
  routes: RouteConfig[];
  globalRates: Record<string, string>;
};

function resolveRates(
  documentRates: Rates,
  pathRates: Rates | undefined,
  operationRates: Rates | undefined,
): Rates {
  if (operationRates) return operationRates;
  if (pathRates) return pathRates;
  return documentRates;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null && !Array.isArray(v);
}

function detectTransport(operation: Record<string, unknown>): TransportType {
  const parameters = operation.parameters;
  if (Array.isArray(parameters)) {
    for (const param of parameters) {
      if (
        isObject(param) &&
        param.in === "header" &&
        typeof param.name === "string" &&
        param.name.toLowerCase() === "upgrade"
      ) {
        return "websocket";
      }
    }
  }

  const responses = operation.responses;
  if (isObject(responses)) {
    for (const response of Object.values(responses)) {
      if (!isObject(response)) continue;
      const content = response.content;
      if (!isObject(content)) continue;
      for (const contentType of Object.keys(content)) {
        if (contentType === "text/event-stream") return "sse";
      }
    }
  }

  return "json";
}

function ratesToStrings(rates: Rates): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rates)) {
    result[key] = String(value);
  }
  return result;
}

function extractPricing(
  obj: Record<string, unknown>,
): { rates?: Rates; rules?: PricingRule[] } | undefined {
  const raw = obj["x-faremeter-pricing"];
  if (!isObject(raw)) return undefined;
  return raw as { rates?: Rates; rules?: PricingRule[] };
}

export function extractSpec(doc: Record<string, unknown>): ParsedSpec {
  const rawAssets = doc["x-faremeter-assets"];
  const assets = isObject(rawAssets)
    ? (rawAssets as Record<string, Asset>)
    : ({} as Record<string, Asset>);
  const documentPricing = extractPricing(doc);
  const documentRates = documentPricing?.rates ?? {};
  const rawPaths = doc.paths;
  if (!isObject(rawPaths)) {
    return { assets, routes: [], globalRates: ratesToStrings(documentRates) };
  }

  const routes: RouteConfig[] = [];

  for (const [path, rawPathItem] of Object.entries(rawPaths)) {
    if (!isObject(rawPathItem)) continue;
    const pathItem = rawPathItem;
    const pathPricing = extractPricing(pathItem);
    const pathRates = pathPricing?.rates;

    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method];
      if (!isObject(rawOp)) continue;
      const operation = rawOp;

      const opPricing = extractPricing(operation);

      if (!opPricing?.rules?.length) continue;

      const rates = resolveRates(documentRates, pathRates, opPricing.rates);
      const transportType = detectTransport(operation);

      const allFields = [];
      let pricingMode: RouteConfig["pricingMode"] = "one-phase";
      for (const rule of opPricing.rules) {
        const analysis = analyzeRule(rule);
        allFields.push(...analysis.captureFields);
        if (analysis.pricingMode === "two-phase") pricingMode = "two-phase";
      }

      const seen = new Set<string>();
      const captureFields = allFields.filter((f) => {
        if (seen.has(f.path)) return false;
        seen.add(f.path);
        return true;
      });

      routes.push({
        path,
        method: method.toUpperCase(),
        pricingRules: ratesToStrings(rates),
        transportType,
        pricingMode,
        captureFields,
      });
    }
  }

  return {
    assets,
    routes,
    globalRates: ratesToStrings(documentRates),
  };
}

export async function loadSpec(filePath: string): Promise<ParsedSpec> {
  const data = await bundle(filePath, {
    plugins: [readFiles(), parseYaml(), parseJson()],
    treeShake: false,
  });
  const { schema, errors } = dereference(data);
  if (errors?.length) {
    throw new Error(
      `OpenAPI dereference errors: ${errors.map((e) => e.message).join(", ")}`,
    );
  }
  return extractSpec(schema as Record<string, unknown>);
}
