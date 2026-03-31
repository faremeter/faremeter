import { JSONPathEnvironment } from "json-p3";
import { Parser } from "expr-eval";
import type {
  EvalContext,
  FaremeterSpec,
  OperationPricing,
  PriceResult,
  PricingRule,
  Rates,
} from "./types";

type PreparedRule = {
  match: string;
  authorize?: string | undefined;
  capture: string;
  source: PricingRule;
};

type PreparedOperation = {
  rates: Rates;
  rules: PreparedRule[];
};

export type EvalError = {
  phase: "authorize" | "capture";
  rule: PricingRule;
  error: unknown;
};

export type EvalErrorHandler = (err: EvalError) => void;

const JSONPATH_REF = /\$(?:\.[\w-]+|\['[^']*'\]|\[\d+\])+/g;

function createExprParser(): Parser {
  const parser = new Parser();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  parser.functions.jsonSize = (value: unknown) => JSON.stringify(value).length;
  return parser;
}

function extractCoalesce(expr: string): {
  arg: string;
  fallback: string;
  start: number;
  end: number;
} | null {
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

function substituteRefs(expression: string): {
  substituted: string;
  refs: string[];
} {
  const refs: string[] = [];
  let varIndex = 0;

  let processed = expression;
  for (;;) {
    const coal = extractCoalesce(processed);
    if (!coal) break;
    refs.push(coal.arg);
    const name = `_v${varIndex++}`;
    const fallbackWithParens = `(${coal.fallback})`;
    processed =
      processed.slice(0, coal.start) +
      `(${name} + 0 * ${fallbackWithParens})` +
      processed.slice(coal.end);
  }

  processed = processed.replace(JSONPATH_REF, (ref) => {
    refs.push(ref);
    return `_v${varIndex++}`;
  });

  return { substituted: processed, refs };
}

function resolveExpression(
  expression: string,
  jpEnv: JSONPathEnvironment,
  ctx: Record<string, unknown>,
  exprParser: Parser,
): number {
  const vars: Record<string, unknown> = {};
  let varIndex = 0;

  let processed = expression;
  for (;;) {
    const coal = extractCoalesce(processed);
    if (!coal) break;
    const nodes = jpEnv.query(coal.arg, ctx as never);
    const values = nodes.values();
    let replacement: string;
    if (values.length === 1 && values[0] != null) {
      const name = `_v${varIndex++}`;
      vars[name] = values[0];
      replacement = name;
    } else {
      replacement = `(${coal.fallback})`;
    }
    processed =
      processed.slice(0, coal.start) + replacement + processed.slice(coal.end);
  }

  processed = processed.replace(JSONPATH_REF, (ref) => {
    const name = `_v${varIndex++}`;
    const nodes = jpEnv.query(ref, ctx as never);
    const values = nodes.values();
    if (values.length !== 1) {
      throw new Error(`JSONPath '${ref}' resolved to ${values.length} values`);
    }
    vars[name] = values[0];
    return name;
  });

  return exprParser.evaluate(processed, vars as Record<string, number>);
}

function validateRateKeys(
  operations: Record<string, PreparedOperation>,
  assets: FaremeterSpec["assets"],
): void {
  const assetKeys = new Set(Object.keys(assets));
  for (const [opKey, op] of Object.entries(operations)) {
    for (const rateKey of Object.keys(op.rates)) {
      if (!assetKeys.has(rateKey)) {
        throw new Error(
          `${opKey}: rate key "${rateKey}" does not match any defined asset (available: ${[...assetKeys].join(", ")})`,
        );
      }
    }
  }
}

function validateExpressions(
  jpEnv: JSONPathEnvironment,
  exprParser: Parser,
  operations: Record<string, PreparedOperation>,
): void {
  for (const [opKey, op] of Object.entries(operations)) {
    for (let i = 0; i < op.rules.length; i++) {
      const rule = op.rules[i];
      if (!rule) continue;

      try {
        jpEnv.compile(rule.match);
      } catch (err) {
        throw new Error(
          `${opKey} rule ${i} match: invalid JSONPath: ${rule.match} - ${err}`,
        );
      }

      const phases = [
        ["authorize", rule.authorize],
        ["capture", rule.capture],
      ] as const;

      for (const [phase, expr] of phases) {
        if (!expr) continue;

        const { substituted, refs } = substituteRefs(expr);

        for (const ref of refs) {
          try {
            jpEnv.compile(ref);
          } catch (err) {
            throw new Error(
              `${opKey} rule ${i} ${phase}: invalid JSONPath ref: ${ref} - ${err}`,
            );
          }
        }

        try {
          exprParser.parse(substituted);
        } catch (err) {
          throw new Error(
            `${opKey} rule ${i} ${phase}: invalid expression: ${expr} - ${err}`,
          );
        }
      }
    }
  }
}

export type PricingEvaluator = {
  authorize(operationKey: string, ctx: EvalContext): PriceResult;
  capture(operationKey: string, ctx: EvalContext): PriceResult;
  getAssets(): FaremeterSpec["assets"];
};

/**
 * Evaluates pricing rules from an OpenAPI spec against request/response context.
 *
 * @param spec - Parsed faremeter spec with assets, operations, and rates
 * @param opts - Optional configuration including error handler
 */
export function createPricingEvaluator(
  spec: FaremeterSpec,
  opts?: { onError?: EvalErrorHandler },
): PricingEvaluator {
  const assets = spec.assets;
  const onError = opts?.onError;
  const jpEnv = new JSONPathEnvironment();
  const exprParser = createExprParser();

  const operations: Record<string, PreparedOperation> = {};
  for (const [key, op] of Object.entries(spec.operations)) {
    operations[key] = prepareOperation(op);
  }

  validateRateKeys(operations, assets);
  validateExpressions(jpEnv, exprParser, operations);

  function evaluateRules(
    op: PreparedOperation,
    phase: "authorize" | "capture",
    ctx: EvalContext,
  ): PriceResult {
    const matchCtx = [{ request: ctx.request }];
    const exprCtx =
      phase === "capture"
        ? ({ request: ctx.request, response: ctx.response } as Record<
            string,
            unknown
          >)
        : ({ request: ctx.request } as Record<string, unknown>);

    for (const rule of op.rules) {
      try {
        const nodes = jpEnv.query(rule.match, matchCtx as never);
        if (nodes.values().length === 0) continue;
      } catch {
        continue;
      }

      const expr = phase === "authorize" ? rule.authorize : rule.capture;
      if (!expr) {
        return { matched: true, amount: {} };
      }

      try {
        const coefficient = resolveExpression(expr, jpEnv, exprCtx, exprParser);
        return buildResult(coefficient, op.rates);
      } catch (error) {
        onError?.({ phase, rule: rule.source, error });
        throw new Error(`pricing expression evaluation failed for ${phase}`, {
          cause: error,
        });
      }
    }

    return { matched: false, amount: {} };
  }

  return {
    authorize(operationKey, ctx) {
      const op = operations[operationKey];
      if (!op) return { matched: false, amount: {} };
      return evaluateRules(op, "authorize", ctx);
    },

    capture(operationKey, ctx) {
      const op = operations[operationKey];
      if (!op) return { matched: false, amount: {} };
      return evaluateRules(op, "capture", ctx);
    },

    getAssets() {
      return assets;
    },
  };
}

function prepareOperation(op: OperationPricing): PreparedOperation {
  const rules: PreparedRule[] = (op.rules ?? []).map((rule) => ({
    match: rule.match,
    authorize: rule.authorize,
    capture: rule.capture,
    source: rule,
  }));

  return { rates: op.rates ?? {}, rules };
}

function buildResult(coefficient: number, rates: Rates): PriceResult {
  const clamped = Math.max(0, coefficient);
  const amount: Record<string, bigint> = {};
  for (const [asset, rate] of Object.entries(rates)) {
    amount[asset] = BigInt(Math.ceil(clamped * rate));
  }
  return { matched: true, amount };
}
