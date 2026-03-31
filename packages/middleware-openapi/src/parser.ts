import { resolve } from "node:path";
import { type } from "arktype";
import { bundle } from "@scalar/json-magic/bundle";
import { readFiles } from "@scalar/json-magic/bundle/plugins/node";
import {
  parseYaml,
  parseJson,
} from "@scalar/json-magic/bundle/plugins/browser";
import { dereference } from "@scalar/openapi-parser";
import { isValidationError } from "@faremeter/types";
import type {
  FaremeterSpec,
  OperationPricing,
  PricingRule,
  Rates,
  TransportType,
} from "./types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

const assetValidator = type({
  chain: "string",
  token: "string",
  // decimals must be a positive integer. A zero-decimal asset would
  // reduce the fixed-point scale used in `buildResult` to `10^0 = 1`,
  // causing fractional coefficients to ceiling-round before the rate
  // multiplication and silently overcharge — reject at spec load time.
  decimals: "number.integer >= 1",
  recipient: "string",
});

const assetsValidator = type("Record<string, unknown>").pipe((raw) => {
  const result: Record<string, typeof assetValidator.infer> = {};
  for (const [key, value] of Object.entries(raw)) {
    const validated = assetValidator(value);
    if (isValidationError(validated)) {
      throw new Error(`x-faremeter-assets["${key}"]: ${validated.summary}`);
    }
    result[key] = validated;
  }
  return result;
});

const pricingRuleValidator = type({
  match: "string",
  "authorize?": "string",
  capture: "string",
});

const pricingExtensionValidator = type({
  "rates?": "Record<string, unknown>",
  "rules?": "unknown[]",
});

/**
 * Parse a user-supplied rate value into a non-negative bigint. Accepts
 * integer JS numbers and integer-only numeric strings. Rejects fractional
 * numbers, NaN, Infinity, negative values, and anything else.
 *
 * Rates are atomic units per 1.0 of coefficient, so fractional rates make
 * no sense at the settlement layer. Callers that need sub-atomic granularity
 * should scale their expression coefficient instead.
 */
function parseRateValue(
  raw: unknown,
  assetKey: string,
  context: string,
): bigint {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new Error(
        `${context} rates["${assetKey}"]: must be an integer, got ${raw}`,
      );
    }
    if (raw < 0) {
      throw new Error(
        `${context} rates["${assetKey}"]: must be non-negative, got ${raw}`,
      );
    }
    return BigInt(raw);
  }
  if (typeof raw === "string") {
    if (!/^\d+$/.test(raw)) {
      throw new Error(
        `${context} rates["${assetKey}"]: must be a non-negative integer ` +
          `string, got "${raw}"`,
      );
    }
    return BigInt(raw);
  }
  throw new Error(
    `${context} rates["${assetKey}"]: must be integer or numeric string, ` +
      `got ${typeof raw}`,
  );
}

function validateRates(raw: unknown, context: string): Rates {
  if (raw == null) return {};
  if (!isRecord(raw)) {
    throw new Error(`${context} rates: must be an object`);
  }
  const result: Rates = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = parseRateValue(value, key, context);
  }
  return result;
}

function validateRules(
  raw: unknown[] | undefined,
  context: string,
): PricingRule[] {
  if (!raw?.length) return [];
  return raw.map((entry, i) => {
    const validated = pricingRuleValidator(entry);
    if (isValidationError(validated)) {
      throw new Error(`${context} rule[${i}]: ${validated.summary}`);
    }
    return validated;
  });
}

function validatePricingExtension(
  raw: unknown,
  context: string,
): { rates?: Rates; rules?: PricingRule[] } | undefined {
  if (raw == null) return undefined;
  const validated = pricingExtensionValidator(raw);
  if (isValidationError(validated)) {
    throw new Error(`${context}: ${validated.summary}`);
  }
  const result: { rates?: Rates; rules?: PricingRule[] } = {};
  if (validated.rates) {
    result.rates = validateRates(validated.rates, context);
  }
  if (validated.rules) {
    result.rules = validateRules(validated.rules, context);
  }
  return result;
}

function resolveRates(
  documentRates: Rates,
  pathRates: Rates | undefined,
  operationRates: Rates | undefined,
): Rates {
  if (operationRates) return operationRates;
  if (pathRates) return pathRates;
  return documentRates;
}

function resolveRules(
  documentRules: PricingRule[] | undefined,
  pathRules: PricingRule[] | undefined,
  operationRules: PricingRule[] | undefined,
): PricingRule[] | undefined {
  // Nearest-wins: operation > path > document. An explicit empty
  // array at any level means "no rules" (opt-out). Undefined means
  // "inherit from the next level up."
  if (operationRules !== undefined) return operationRules;
  if (pathRules !== undefined) return pathRules;
  if (documentRules !== undefined) return documentRules;
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null && !Array.isArray(v);
}

function detectTransport(operation: Record<string, unknown>): TransportType {
  const parameters = operation.parameters;
  if (Array.isArray(parameters)) {
    for (const param of parameters) {
      if (
        isRecord(param) &&
        param.in === "header" &&
        typeof param.name === "string" &&
        param.name.toLowerCase() === "upgrade"
      ) {
        return "websocket";
      }
    }
  }

  const responses = operation.responses;
  if (isRecord(responses)) {
    for (const response of Object.values(responses)) {
      if (!isRecord(response)) continue;
      const content = response.content;
      if (!isRecord(content)) continue;
      for (const contentType of Object.keys(content)) {
        if (contentType === "text/event-stream") return "sse";
      }
    }
  }

  return "json";
}

/**
 * Load and parse an OpenAPI spec file, extracting x-faremeter pricing extensions.
 *
 * @param filePath - Path to the OpenAPI YAML or JSON file
 */
export async function loadSpec(filePath: string): Promise<FaremeterSpec> {
  const data = await bundle(resolve(filePath), {
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

/**
 * Extract x-faremeter pricing extensions from a dereferenced OpenAPI document.
 *
 * @param doc - Dereferenced OpenAPI document as a plain object
 */
export function extractSpec(doc: Record<string, unknown>): FaremeterSpec {
  const rawAssets = doc["x-faremeter-assets"] ?? {};
  const assets = assetsValidator(rawAssets);
  if (isValidationError(assets)) {
    throw new Error(`x-faremeter-assets: ${assets.summary}`);
  }

  const documentPricing = validatePricingExtension(
    doc["x-faremeter-pricing"],
    "document x-faremeter-pricing",
  );
  const documentRates = documentPricing?.rates ?? {};
  const documentRules = documentPricing?.rules;

  if (!isRecord(doc.paths)) {
    return { assets, operations: {} };
  }
  const paths = doc.paths;

  const operations: Record<string, OperationPricing> = {};

  for (const [path, rawPathItem] of Object.entries(paths)) {
    if (!isRecord(rawPathItem)) {
      continue;
    }
    const pathItem = rawPathItem;

    const pathPricing = validatePricingExtension(
      pathItem["x-faremeter-pricing"],
      `paths["${path}"] x-faremeter-pricing`,
    );
    const pathRates = pathPricing?.rates;
    const pathRules = pathPricing?.rules;

    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method];
      if (!isRecord(rawOperation)) {
        continue;
      }
      const operation = rawOperation;

      const opPricing = validatePricingExtension(
        operation["x-faremeter-pricing"],
        `paths["${path}"].${method} x-faremeter-pricing`,
      );

      const rules = resolveRules(documentRules, pathRules, opPricing?.rules);
      if (!rules || rules.length === 0) continue;

      const rates = resolveRates(documentRates, pathRates, opPricing?.rates);
      const transport = detectTransport(operation);
      const upperMethod = method.toUpperCase();
      const key = `${upperMethod} ${path}`;
      operations[key] = {
        method: upperMethod,
        path,
        transport,
        rates,
        rules,
      };
    }
  }

  return { assets, operations };
}
