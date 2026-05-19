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
import type { PaymentPolicy } from "@faremeter/middleware/common";
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

const pinEntryValidator = type({
  "capturesAt?": '"request" | "response"',
});

const policyValidator = type({
  "allow?": "string[]",
  "pin?": "Record<string, unknown>",
});

/**
 * Parses an `x-faremeter-policy` block. Shape validation only; cross-
 * referencing against registered handlers (allow/pin entries that
 * don't match any known scheme or method, pin to "response" on a
 * settle-only handler, etc.) happens at `createGatewayHandler`
 * construction time, where the handler set is known.
 */
function validatePolicyExtension(
  raw: unknown,
  context: string,
): PaymentPolicy | undefined {
  if (raw == null) return undefined;
  const validated = policyValidator(raw);
  if (isValidationError(validated)) {
    throw new Error(`${context}: ${validated.summary}`);
  }
  const result: PaymentPolicy = {};
  if (validated.allow !== undefined) {
    result.allow = validated.allow;
  }
  if (validated.pin !== undefined) {
    const pin: Record<string, { capturesAt?: "request" | "response" }> = {};
    for (const [key, entry] of Object.entries(validated.pin)) {
      const validatedEntry = pinEntryValidator(entry);
      if (isValidationError(validatedEntry)) {
        throw new Error(`${context} pin["${key}"]: ${validatedEntry.summary}`);
      }
      pin[key] = validatedEntry;
    }
    result.pin = pin;
  }
  return result;
}

/**
 * `x-faremeter-policy` is operation-level only for this commit.
 * Inheritance from path-level or document-level is a future piece of
 * work; for now an extension at those levels is rejected loudly so
 * operators do not silently misconfigure routes by writing
 * inheritable-looking policy.
 */
function rejectPolicyAtNonOperationLevel(raw: unknown, level: string): void {
  if (raw != null) {
    throw new Error(
      `${level}: x-faremeter-policy is only supported at the operation ` +
        `level; remove it here or move it onto each operation that needs ` +
        `it`,
    );
  }
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

  rejectPolicyAtNonOperationLevel(doc["x-faremeter-policy"], "document");

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

    rejectPolicyAtNonOperationLevel(
      pathItem["x-faremeter-policy"],
      `paths["${path}"]`,
    );

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

      // Extract the policy block first so an orphan policy (defined
      // on an operation that has no pricing rules) surfaces loudly
      // rather than being silently dropped along with the unpriced
      // operation. Without this, deleting pricing from an operation
      // leaves its `x-faremeter-policy` in place with no effect and
      // no signal to the operator that their config is dead.
      const policy = validatePolicyExtension(
        operation["x-faremeter-policy"],
        `paths["${path}"].${method} x-faremeter-policy`,
      );

      const rules = resolveRules(documentRules, pathRules, opPricing?.rules);
      if (!rules || rules.length === 0) {
        if (policy !== undefined) {
          throw new Error(
            `paths["${path}"].${method}: x-faremeter-policy is declared but ` +
              `the operation has no x-faremeter-pricing rules; either remove ` +
              `the policy or add rules for it to gate`,
          );
        }
        continue;
      }

      const rates = resolveRates(documentRates, pathRates, opPricing?.rates);
      const transport = detectTransport(operation);
      const upperMethod = method.toUpperCase();
      const key = `${upperMethod} ${path}`;
      const operationPricing: OperationPricing = {
        method: upperMethod,
        path,
        transport,
        rates,
        rules,
      };
      if (policy !== undefined) {
        operationPricing.policy = policy;
      }
      operations[key] = operationPricing;
    }
  }

  return { assets, operations };
}
