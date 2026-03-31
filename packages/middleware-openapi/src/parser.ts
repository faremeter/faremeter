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
} from "./types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

const assetValidator = type({
  chain: "string",
  token: "string",
  decimals: "number",
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

const ratesValidator = type("Record<string, number>");

const pricingRuleValidator = type({
  match: "string",
  "authorize?": "string",
  capture: "string",
});

const pricingExtensionValidator = type({
  "rates?": "Record<string, number>",
  "rules?": "unknown[]",
});

function validateRates(raw: unknown, context: string): Rates {
  if (raw == null) return {};
  const validated = ratesValidator(raw);
  if (isValidationError(validated)) {
    throw new Error(`${context} rates: ${validated.summary}`);
  }
  return validated;
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

  if (
    typeof doc.paths !== "object" ||
    doc.paths == null ||
    Array.isArray(doc.paths)
  ) {
    return { assets, operations: {} };
  }
  const paths = doc.paths as Record<string, unknown>;

  const operations: Record<string, OperationPricing> = {};

  for (const [path, rawPathItem] of Object.entries(paths)) {
    if (
      typeof rawPathItem !== "object" ||
      rawPathItem == null ||
      Array.isArray(rawPathItem)
    ) {
      continue;
    }
    const pathItem = rawPathItem as Record<string, unknown>;

    const pathPricing = validatePricingExtension(
      pathItem["x-faremeter-pricing"],
      `paths["${path}"] x-faremeter-pricing`,
    );
    const pathRates = pathPricing?.rates;

    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method];
      if (
        typeof rawOperation !== "object" ||
        rawOperation == null ||
        Array.isArray(rawOperation)
      ) {
        continue;
      }
      const operation = rawOperation as Record<string, unknown>;

      const opPricing = validatePricingExtension(
        operation["x-faremeter-pricing"],
        `paths["${path}"].${method} x-faremeter-pricing`,
      );
      if (!opPricing?.rules?.length) continue;

      const rates = resolveRates(documentRates, pathRates, opPricing.rates);
      const key = `${method.toUpperCase()} ${path}`;
      operations[key] = { rates, rules: opPricing.rules };
    }
  }

  return { assets, operations };
}
