import { JSONPathEnvironment } from "json-p3";
import { Parser } from "expr-eval";
import { JSONPATH_REF, extractPlainRefs, findInnermostCoalesce } from "./expr";
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
  // A filter-style match (`$[?...]`) iterates array elements and
  // binds `@` to each, so it needs the single-element array context.
  // A bare selector (`$.request.body.foo`) evaluates key-by-key
  // against the object context. The shape is decided once at
  // prepare time so each rule runs a single `jpEnv.query` at
  // evaluation time instead of the dual-context fallback.
  matchIsFilter: boolean;
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

function createExprParser(): Parser {
  const parser = new Parser();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  parser.functions.jsonSize = (value: unknown) => JSON.stringify(value).length;
  return parser;
}

// Reserved identifier prefix used to substitute JSONPath refs into
// expressions. User expressions may not reference identifiers beginning
// with this prefix — see `assertNoReservedRefs`.
const REF_VAR_PREFIX = "__fm_ref_";

const RESERVED_REF_PATTERN = new RegExp(`\\b${REF_VAR_PREFIX}[0-9]+\\b`, "g");

function assertNoReservedRefs(
  opKey: string,
  ruleIndex: number,
  phase: "authorize" | "capture",
  expression: string,
): void {
  RESERVED_REF_PATTERN.lastIndex = 0;
  const match = RESERVED_REF_PATTERN.exec(expression);
  if (match) {
    throw new Error(
      `${opKey} rule ${ruleIndex} ${phase}: expression must not reference ` +
        `reserved identifier "${match[0]}" — the "${REF_VAR_PREFIX}" prefix ` +
        `is reserved for internal JSONPath substitution`,
    );
  }
}

function substituteRefs(expression: string): {
  substituted: string;
  refs: string[];
} {
  const refs: string[] = [];
  let varIndex = 0;

  let processed = expression;
  // Process innermost coalesces first so that by the time an outer
  // coalesce is handled, every inner coalesce in its arg/fallback has
  // already been collapsed to a plain subexpression. See
  // {@link findInnermostCoalesce} for the rationale.
  for (;;) {
    const coal = findInnermostCoalesce(processed);
    if (!coal) break;
    // Coalesce primary may be:
    // 1. A literal / computed constant (`5`, `-3 + 2`) — always used.
    // 2. An expression containing one or more JSONPath refs (bare
    //    `$.x`, parenthesized `($.x)`, negated `-$.x`, function-wrapped
    //    `jsonSize($.x)`) — the ref(s) are resolved at runtime; if any
    //    is nil, the fallback is used.
    // Distinguish by whether the primary contains any JSONPath refs,
    // not by whether it begins with `$` — the startsWith check
    // misclassifies wrapped refs as literals and silently loses the
    // coalesce's null-safety.
    const argRefs = extractPlainRefs(coal.arg);
    let replacement: string;
    if (argRefs.length === 0) {
      // Literal primary — at runtime the fallback is unreachable
      // because a literal is never nil, but at validation time we
      // still want expr-eval to parse-check the fallback so a
      // typo'd function name or bad syntax surfaces at spec load
      // rather than going dormant until a future refactor changes
      // the primary into a ref. The `+ 0 * (fallback)` term keeps
      // the fallback in the parse tree without affecting the
      // computed value.
      replacement = `((${coal.arg}) + 0 * (${coal.fallback}))`;
    } else {
      // Substitute refs in the primary so it becomes a valid expr-eval
      // expression at validation time. The `+ 0 * (fallback)` term
      // keeps the fallback expression syntactically validated without
      // affecting the final value (runtime null-safety lives in
      // resolveExpression).
      let substituted = coal.arg;
      for (const ref of argRefs) {
        refs.push(ref);
        const name = `${REF_VAR_PREFIX}${varIndex++}`;
        substituted = substituted.replace(ref, name);
      }
      replacement = `((${substituted}) + 0 * (${coal.fallback}))`;
    }
    processed =
      processed.slice(0, coal.start) + replacement + processed.slice(coal.end);
  }

  processed = processed.replace(JSONPATH_REF, (ref) => {
    refs.push(ref);
    return `${REF_VAR_PREFIX}${varIndex++}`;
  });

  return { substituted: processed, refs };
}

/**
 * JSONPath refs can resolve to any JSON value: numbers drive arithmetic,
 * strings/arrays/objects can be inputs to custom expr-eval functions such as
 * `jsonSize()`. We keep the extracted values as `unknown` (honest about
 * runtime contents) and let expr-eval surface its own error if a non-numeric
 * value flows into an arithmetic slot. A non-finite numeric result from the
 * evaluator itself is rejected in {@link buildResult}.
 */
function resolveExpression(
  expression: string,
  jpEnv: JSONPathEnvironment,
  ctx: Record<string, unknown>,
  exprParser: Parser,
): { coefficient: number; bindings: Record<string, unknown> } {
  const vars: Record<string, unknown> = {};
  const bindings: Record<string, unknown> = {};
  let varIndex = 0;

  let processed = expression;
  // Process innermost coalesces first so that by the time an outer
  // coalesce is handled, every inner coalesce in its arg/fallback has
  // already been reduced to a plain subexpression with no further
  // coalesce semantics to honor. See {@link findInnermostCoalesce}.
  for (;;) {
    const coal = findInnermostCoalesce(processed);
    if (!coal) break;
    const argRefs = extractPlainRefs(coal.arg);
    let replacement: string;
    if (argRefs.length === 0) {
      // Literal primary — never nullish, use directly.
      replacement = `(${coal.arg})`;
    } else {
      // Primary contains one or more JSONPath refs. Resolve each; if
      // any is nil (zero nodes) or explicitly null, use the fallback.
      // Otherwise substitute the refs into the primary expression so
      // expr-eval can evaluate it with the resolved values.
      let anyNil = false;
      let substituted = coal.arg;
      const localVars: Record<string, unknown> = {};
      const localBindings: Record<string, unknown> = {};
      for (const ref of argRefs) {
        const nodes = jpEnv.query(ref, ctx as never);
        const values = nodes.values();
        if (values.length !== 1 || values[0] == null) {
          anyNil = true;
          break;
        }
        const name = `${REF_VAR_PREFIX}${varIndex++}`;
        localVars[name] = values[0];
        localBindings[ref] = values[0];
        substituted = substituted.replace(ref, name);
      }
      if (anyNil) {
        replacement = `(${coal.fallback})`;
      } else {
        Object.assign(vars, localVars);
        Object.assign(bindings, localBindings);
        replacement = `(${substituted})`;
      }
    }
    processed =
      processed.slice(0, coal.start) + replacement + processed.slice(coal.end);
  }

  processed = processed.replace(JSONPATH_REF, (ref) => {
    const name = `${REF_VAR_PREFIX}${varIndex++}`;
    const nodes = jpEnv.query(ref, ctx as never);
    const values = nodes.values();
    if (values.length !== 1) {
      throw new Error(`JSONPath '${ref}' resolved to ${values.length} values`);
    }
    vars[name] = values[0];
    bindings[ref] = values[0];
    return name;
  });

  // expr-eval's public `Values` type accepts number | string | function |
  // record; arrays and null survive at runtime through its member-access
  // pathway and through user-defined functions such as `jsonSize()`. The
  // cast here is the one narrow library-boundary assertion in this file.
  const result = exprParser.evaluate(processed, vars as Record<string, number>);
  if (typeof result !== "number") {
    throw new Error(
      `expression '${expression}' evaluated to non-numeric ${typeof result}`,
    );
  }
  if (!Number.isFinite(result)) {
    throw new Error(
      `expression '${expression}' evaluated to non-finite number`,
    );
  }
  return { coefficient: result, bindings };
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

      // Match runs at both access-phase (/request) and log-phase
      // (/response), but the match context is strictly
      // `{request: ...}` in both — there is no `response` field.
      // A filter like `$[?@.response.status == 200]` silently
      // returns zero nodes and never matches, bypassing billing
      // forever with no error at load time. Reject loudly.
      // Check both `$.response` (bare selectors) and `@.response`
      // (filter-bound element references) since match expressions
      // commonly use filters like `$[?@.field == 'x']`.
      if (/[$@]\.response\b/.test(rule.match)) {
        throw new Error(
          `${opKey} rule ${i} match: expression must not reference ` +
            `.response.* (match runs against the request only, in ` +
            `both access and log phases)`,
        );
      }

      // capture is required and must not be empty. authorize is
      // optional at the validator level — capture-only rules are
      // rejected at settlement time in handleResponse when they would
      // produce a non-empty capture amount without a matching
      // authorize (the silent-billing-gap case).
      if (rule.capture.trim() === "") {
        throw new Error(
          `${opKey} rule ${i} capture: expression must not be empty`,
        );
      }
      if (rule.authorize !== undefined && rule.authorize.trim() === "") {
        throw new Error(
          `${opKey} rule ${i} authorize: expression must not be empty`,
        );
      }

      const phases = [
        ["authorize", rule.authorize],
        ["capture", rule.capture],
      ] as const;

      for (const [phase, expr] of phases) {
        if (!expr) continue;

        assertNoReservedRefs(opKey, i, phase, expr);

        // authorize runs before any response exists, so referencing
        // $.response.* is always a load-time mistake.
        if (phase === "authorize" && /\$\.response\b/.test(expr)) {
          throw new Error(
            `${opKey} rule ${i} authorize: expression must not reference ` +
              `$.response.* (authorize runs before the response is available)`,
          );
        }

        // One-phase pricing: when a rule has no authorize expression,
        // the capture expression is evaluated at request time (before
        // the upstream response exists) to compute the upfront payment
        // amount. A $.response.* reference would resolve to zero nodes
        // at runtime and silently produce the wrong price. Reject at
        // load time so the spec author gets a clear signal.
        if (
          phase === "capture" &&
          !rule.authorize &&
          /\$\.response\b/.test(expr)
        ) {
          throw new Error(
            `${opKey} rule ${i} capture: one-phase rule (no authorize) ` +
              `must not reference $.response.* in its capture expression ` +
              `(capture runs before the response is available when ` +
              `authorize is omitted)`,
          );
        }

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

        let parsed;
        try {
          parsed = exprParser.parse(substituted);
        } catch (err) {
          throw new Error(
            `${opKey} rule ${i} ${phase}: invalid expression: ${expr} - ${err}`,
          );
        }

        // expr-eval treats unknown function calls as late-bound
        // variable lookups, so a typo like `mycoalesce(x, 5)` parses
        // cleanly and only fails at evaluate time with
        // "undefined variable". Every legitimate variable in the
        // substituted expression is a `__fm_ref_N` placeholder (real
        // JSONPath refs were rewritten by substituteRefs); anything
        // else is an unknown function or variable and must be
        // rejected at construction.
        for (const v of parsed.variables()) {
          if (!v.startsWith(REF_VAR_PREFIX)) {
            throw new Error(
              `${opKey} rule ${i} ${phase}: invalid expression: ${expr} - ` +
                `unknown function or variable "${v}"`,
            );
          }
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
    // Match contexts: bare selectors like `$.request.body.foo`
    // evaluate against the object context; filter queries like
    // `$[?@.request.body.model == "gpt-4o"]` need the
    // single-element array context so `@` binds to the element.
    // `matchIsFilter` is precomputed per rule at prepare time so
    // each rule runs exactly one `jpEnv.query` at evaluation time.
    const matchCtxObject = { request: ctx.request };
    const matchCtxArray = [matchCtxObject];
    const exprCtx: Record<string, unknown> =
      phase === "capture"
        ? { request: ctx.request, response: ctx.response }
        : { request: ctx.request };

    for (let i = 0; i < op.rules.length; i++) {
      const rule = op.rules[i];
      if (!rule) continue;
      // Match JSONPath has already been compiled during validateExpressions,
      // so a runtime throw here is a real bug — let it propagate.
      const matchCtx = rule.matchIsFilter ? matchCtxArray : matchCtxObject;
      const nodes = jpEnv.query(rule.match, matchCtx as never);
      if (nodes.values().length === 0) continue;

      let expr = phase === "authorize" ? rule.authorize : rule.capture;
      const ruleHasAuthorize = rule.authorize !== undefined;
      if (!expr && phase === "authorize") {
        // No authorize expression: the capture expression runs
        // pre-request as the payment amount. The context is
        // request-only (no response), so capture expressions that
        // reference $.response.* will fail — validateExpressions
        // rejects those at construction time.
        expr = rule.capture;
      }
      if (!expr) {
        return { matched: true, amount: {} };
      }

      try {
        const { coefficient, bindings } = resolveExpression(
          expr,
          jpEnv,
          exprCtx,
          exprParser,
        );
        const result = buildResult(coefficient, op.rates);
        result.ruleIndex = i;
        result.rule = rule.source;
        result.trace = { coefficient, bindings };
        if (phase === "authorize") {
          result.hasAuthorize = ruleHasAuthorize;
        }
        return result;
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
    matchIsFilter: rule.match.trimStart().startsWith("$["),
    authorize: rule.authorize,
    capture: rule.capture,
    source: rule,
  }));

  return { rates: op.rates ?? {}, rules };
}

/**
 * Compute per-asset amounts as `bigint`. The coefficient is a `number`
 * returned from expr-eval and therefore carries IEEE-754 drift for
 * inputs like `0.1 + 0.2` (which evaluates to 0.30000000000000004).
 *
 * The precision scale is a fixed `1e15` — the largest power of ten
 * still representable exactly in an IEEE-754 double, and therefore the
 * highest fractional precision we can extract from a JS number without
 * risking safe-integer loss in the intermediate multiply. The scale is
 * deliberately *not* tied to the asset's `decimals`: the asset's
 * decimals describes the token's atomic-unit size, not the coefficient
 * precision we need before applying the rate. Tying the scale to
 * decimals would silently undercharge any coefficient smaller than
 * `10^-decimals` when the rate is larger than `10^decimals` — which is
 * the common case for USDC (decimals=6) with rates in the 10^12 range
 * (see the USDC undercharge regression in `evaluator.test.ts`).
 *
 * We use `toFixed(COEFFICIENT_PRECISION_DIGITS)` with an explicit
 * residual-detection pass so that coefficients beyond the safe-integer
 * range also produce a bigint cleanly (coefficient >= 1e21 causes
 * `toFixed` to return exponential notation; we detect that and fall
 * back to the integer portion). Multiplication and ceiling rounding
 * happen entirely in bigint arithmetic after that.
 */
const COEFFICIENT_PRECISION_DIGITS = 15;
const COEFFICIENT_SCALE = 10n ** BigInt(COEFFICIENT_PRECISION_DIGITS);

function coefficientToScaledBigInt(coefficient: number): bigint {
  if (coefficient === 0) return 0n;
  const str = coefficient.toFixed(COEFFICIENT_PRECISION_DIGITS);
  // toFixed switches to exponential notation for magnitudes >= 1e21
  // (e.g. `(1e21).toFixed(15) === "1e+21"`). Detect and fall back to
  // Math.round when the string contains `e`; the coefficient is
  // already so large that sub-unit precision is irrelevant.
  if (str.includes("e") || str.includes("E")) {
    return BigInt(Math.round(coefficient)) * COEFFICIENT_SCALE;
  }
  const [wholeStr = "0", fracStr = ""] = str.split(".");
  const paddedFrac = fracStr.padEnd(COEFFICIENT_PRECISION_DIGITS, "0");
  return BigInt(wholeStr + paddedFrac);
}

function buildResult(coefficient: number, rates: Rates): PriceResult {
  if (!Number.isFinite(coefficient)) {
    throw new Error(`pricing coefficient is not finite: ${coefficient}`);
  }
  // Negative coefficients are almost always a spec bug (e.g. a
  // subtraction expression where the subtrahend can exceed the
  // minuend on some responses). Silently clamping to zero would
  // produce a non-obvious zero-bill with no signal to the spec
  // author. Fail loud so the misconfiguration surfaces.
  if (coefficient < 0) {
    throw new Error(
      `pricing coefficient is negative (${coefficient}): ` +
        `capture expressions must produce non-negative values`,
    );
  }
  const scaled = coefficientToScaledBigInt(coefficient);
  const amount: Record<string, bigint> = {};
  for (const [assetName, rate] of Object.entries(rates)) {
    // ceil(scaled * rate / COEFFICIENT_SCALE)
    amount[assetName] =
      (scaled * rate + COEFFICIENT_SCALE - 1n) / COEFFICIENT_SCALE;
  }
  return { matched: true, amount };
}
