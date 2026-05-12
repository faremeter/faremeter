import { type } from "arktype";
import type { mppReceipt } from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";
import type {
  x402VerifyResponse as x402VerifyResponseV1,
  x402SettleResponse as x402SettleResponseV1,
} from "@faremeter/types/x402";
import type {
  x402VerifyResponse as x402VerifyResponseV2,
  x402SettleResponse as x402SettleResponseV2,
} from "@faremeter/types/x402v2";
import type { SupportedVersionsConfig } from "@faremeter/middleware/common";
import {
  handleMiddlewareRequest,
  resolveSupportedVersions,
  type MiddlewareBodyContext,
} from "@faremeter/middleware/common";
import { createPricingEvaluator, type PricingEvaluator } from "./evaluator";
import { buildContext, withResponse } from "./context";
import { logger } from "./logger";
import type {
  Asset,
  EvalContext,
  EvalTrace,
  FaremeterSpec,
  HandlerBinding,
  MPPBinding,
  PriceResult,
} from "./types";

export type GatewayHandlerConfig = {
  spec: FaremeterSpec;
  baseURL: string;
  bindings?: HandlerBinding[];
  mppBindings?: MPPBinding[];
  supportedVersions?: SupportedVersionsConfig;
  /**
   * Called post-settlement when a binding's rule matched and produced
   * a non-empty capture amount. `result.phase` indicates whether
   * settlement happened at `/request` (one-phase) or `/response`
   * (two-phase). Phase is determined by the matched rule on the
   * dispatched binding — a rule with `authorize` runs as two-phase;
   * a rule without runs as one-phase.
   *
   * For two-phase rules the hook fires at `/response` when settlement
   * is attempted, regardless of whether it succeeded or failed
   * (`result.settled` and `result.error` distinguish the outcome).
   * For one-phase rules the hook fires at `/request` only on
   * successful settlement -- if the facilitator rejects the payment,
   * the request gets a 402 and the hook is not invoked.
   *
   * The hook does NOT fire when the capture expression evaluates to
   * zero across all assets. A zero-amount capture produces no
   * settlement and no hook invocation.
   *
   * The hook is awaited -- a slow async hook delays the caller. The
   * return value is computed before the hook is invoked, so a throw
   * or rejected promise is caught and logged without affecting it.
   */
  onCapture?: (
    operationKey: string,
    result: CaptureResponse,
  ) => void | Promise<void>;
  /**
   * Called when a two-phase rule's payment is successfully verified at
   * `/request` time. Does not fire for one-phase (capture-only) rules,
   * which settle immediately and report through `onCapture` instead.
   * Does not fire when verification fails (the request gets a 402).
   *
   * The hook is awaited -- a slow async hook delays the caller. A
   * throw or rejected promise is caught and logged without affecting
   * the gateway response, which is already determined at this point.
   */
  onAuthorize?: (
    operationKey: string,
    result: AuthorizeResponse,
  ) => void | Promise<void>;
};

export type AuthorizeResponse =
  | { protocol: "x402v1"; verification: x402VerifyResponseV1 }
  | { protocol: "x402v2"; verification: x402VerifyResponseV2 }
  | { protocol: "mpp"; verification: mppReceipt };

export type SettledPayment =
  | { protocol: "x402v1"; settlement: x402SettleResponseV1 }
  | { protocol: "x402v2"; settlement: x402SettleResponseV2 }
  | { protocol: "mpp"; settlement: mppReceipt };

const HEADER_MAP = "Record<string, string | string[]>";

export const requestContext = type({
  operationKey: "string",
  method: "string",
  path: "string",
  headers: HEADER_MAP,
  query: HEADER_MAP,
  body: "Record<string, unknown> | null",
});

export type RequestContext = typeof requestContext.infer;

export const responseContext = type({
  operationKey: "string",
  method: "string",
  path: "string",
  headers: HEADER_MAP,
  query: HEADER_MAP,
  body: "Record<string, unknown> | null",
  response: {
    status: "number",
    headers: HEADER_MAP,
    body: "Record<string, unknown>",
  },
});

export type ResponseContext = typeof responseContext.infer;

export type GatewayRequestResult = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type GatewayResponseResult = {
  status: number;
};

export type CapturePhase = "request" | "response";

export type CaptureError = {
  status: number;
  message?: string;
};

function toCaptureError(status: number, message?: string): CaptureError {
  const error: CaptureError = { status };
  if (message !== undefined) {
    error.message = message;
  }
  return error;
}

export type CaptureRequestInfo = {
  method: string;
  path: string;
  headers: Record<string, string>;
};

export type CaptureResponse = {
  phase: CapturePhase;
  settled: boolean;
  amount: Record<string, string>;
  // The original client request's method, path, and headers as
  // forwarded by the gateway. Useful for correlating settlement
  // events with access logs (e.g. via x-request-id).
  request: CaptureRequestInfo;
  // When settlement is attempted and fails, the error is propagated
  // here. Absent for successful settlements.
  error?: CaptureError;
  trace?: EvalTrace;
  // Present when settlement succeeded at this phase and a payment
  // handler returned a receipt. Absent when settlement failed
  // (`settled: false`, `error` is set).
  payment?: SettledPayment;
};

export type GatewayHandler = {
  handleRequest(ctx: RequestContext): Promise<GatewayRequestResult>;
  handleResponse(ctx: ResponseContext): Promise<GatewayResponseResult>;
};

const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE", "OPTIONS"]);

function requireBody(
  body: Record<string, unknown> | null,
  method: string,
  phase: "handleRequest" | "handleResponse",
): Record<string, unknown> {
  if (body !== null) {
    return body;
  }
  if (BODYLESS_METHODS.has(method.toUpperCase())) {
    return {};
  }
  throw new Error(
    `${phase}: request body is null for ${method} — the gateway must ` +
      `forward a JSON object (use {} for truly empty bodies). Null body ` +
      `would silently bypass any rule whose match references $.request.body.*`,
  );
}

function toPricing(
  amount: Record<string, bigint>,
  assets: Record<string, Asset>,
): ResourcePricing[] {
  return Object.entries(amount).flatMap(([name, qty]) => {
    if (qty === 0n) return [];
    const asset = assets[name];
    if (!asset) return [];
    return [
      {
        amount: qty.toString(),
        asset: asset.token,
        network: asset.chain,
        recipient: asset.recipient,
        description: name,
      },
    ];
  });
}

function amountToJSON(amount: Record<string, bigint>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(amount)) {
    result[k] = v.toString();
  }
  return result;
}

function normalizeHeaderMap(
  map: Record<string, string | string[]>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

function normalizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function makeHeaderGetter(
  headers: Record<string, string>,
): (key: string) => string | undefined {
  const normalized = normalizeHeaders(headers);
  return (key: string) => normalized[key.toLowerCase()];
}

function makeBodyGetter(
  method: string,
  body: Record<string, unknown> | null,
): () => Promise<ArrayBuffer | null> {
  return async () => {
    if (method === "GET" || method === "HEAD" || body == null) {
      return null;
    }
    return new TextEncoder().encode(JSON.stringify(body)).buffer.slice(0);
  };
}

type X402BindingState = {
  binding: HandlerBinding;
  evaluator: PricingEvaluator;
};

type MPPBindingState = {
  binding: MPPBinding;
  evaluator: PricingEvaluator;
};

function buildSchemeIndex(
  states: X402BindingState[],
): Map<string, X402BindingState> {
  const index = new Map<string, X402BindingState>();
  for (const state of states) {
    const schemes = state.binding.handler.capabilities?.schemes ?? [];
    if (schemes.length === 0) {
      throw new Error(
        "createGatewayHandler: x402 binding handler has no schemes in " +
          "capabilities; bindings must declare at least one scheme",
      );
    }
    for (const scheme of schemes) {
      if (index.has(scheme)) {
        throw new Error(
          `createGatewayHandler: scheme "${scheme}" is claimed by more ` +
            `than one binding; schemes must be unique across bindings`,
        );
      }
      index.set(scheme, state);
    }
  }
  return index;
}

function buildMethodIndex(
  states: MPPBindingState[],
): Map<string, MPPBindingState> {
  const index = new Map<string, MPPBindingState>();
  for (const state of states) {
    const method = state.binding.handler.method;
    if (index.has(method)) {
      throw new Error(
        `createGatewayHandler: MPP method "${method}" is claimed by more ` +
          `than one binding; methods must be unique across MPP bindings`,
      );
    }
    index.set(method, state);
  }
  return index;
}

function lookupBindingForContext<MR>(
  context: MiddlewareBodyContext<MR>,
  schemeIndex: Map<string, X402BindingState>,
  methodIndex: Map<string, MPPBindingState>,
):
  | { kind: "x402"; state: X402BindingState }
  | { kind: "mpp"; state: MPPBindingState }
  | undefined {
  if (context.protocolVersion === "mpp") {
    const state = methodIndex.get(context.credential.challenge.method);
    if (!state) return undefined;
    return { kind: "mpp", state };
  }
  const scheme = context.paymentRequirements.scheme;
  const state = schemeIndex.get(scheme);
  if (!state) return undefined;
  return { kind: "x402", state };
}

export function createGatewayHandler(
  config: GatewayHandlerConfig,
): GatewayHandler {
  const {
    spec,
    baseURL,
    bindings = [],
    mppBindings = [],
    onCapture,
    onAuthorize,
  } = config;
  if (!baseURL) {
    throw new Error("createGatewayHandler: baseURL is required");
  }
  if (bindings.length === 0 && mppBindings.length === 0) {
    logger.warning(
      "createGatewayHandler: no bindings configured; /request can still " +
        "advertise 402 pricing only if a binding produces it, which is " +
        "impossible without bindings — every request will pass through unpaid",
    );
  }

  const supportedVersions = resolveSupportedVersions(config.supportedVersions);

  const x402States: X402BindingState[] = bindings.map((binding) => ({
    binding,
    evaluator: createPricingEvaluator({
      assets: spec.assets,
      operations: binding.operations,
    }),
  }));
  const mppStates: MPPBindingState[] = mppBindings.map((binding) => ({
    binding,
    evaluator: createPricingEvaluator({
      assets: spec.assets,
      operations: binding.operations,
    }),
  }));

  const schemeIndex = buildSchemeIndex(x402States);
  const methodIndex = buildMethodIndex(mppStates);

  function evaluateAllAuthorize(
    operationKey: string,
    ctx: EvalContext,
  ): {
    x402: PriceResult[];
    mpp: PriceResult[];
    pricing: ResourcePricing[];
  } {
    const x402 = x402States.map((s) =>
      s.evaluator.authorize(operationKey, ctx),
    );
    const mpp = mppStates.map((s) => s.evaluator.authorize(operationKey, ctx));
    const pricing: ResourcePricing[] = [];
    for (const r of x402) {
      if (r.matched) pricing.push(...toPricing(r.amount, spec.assets));
    }
    for (const r of mpp) {
      if (r.matched) pricing.push(...toPricing(r.amount, spec.assets));
    }
    return { x402, mpp, pricing };
  }

  async function handleRequest(
    ctx: RequestContext,
  ): Promise<GatewayRequestResult> {
    const headers = normalizeHeaderMap(ctx.headers);
    const query = normalizeHeaderMap(ctx.query);
    const body = requireBody(ctx.body, ctx.method, "handleRequest");
    const evalCtx = buildContext({ body, headers, query, path: ctx.path });

    const { x402, mpp, pricing } = evaluateAllAuthorize(
      ctx.operationKey,
      evalCtx,
    );

    if (pricing.length === 0) {
      // No binding's rule matched (or all matched at zero). Unpaid
      // request passes through.
      logger.debug("no binding rule produced pricing", {
        operationKey: ctx.operationKey,
      });
      return { status: 200 };
    }

    const responseHeaders: Record<string, string> = {};
    let settledAtRequest = false;
    let settledPayment: SettledPayment | undefined;
    let authorizeResponse: AuthorizeResponse | undefined;
    let dispatchedRule: PriceResult | undefined;

    const result = await handleMiddlewareRequest<GatewayRequestResult>({
      x402Handlers: bindings.map((b) => b.handler),
      mppMethodHandlers: mppBindings.map((b) => b.handler),
      pricing,
      resource: new URL(ctx.path, baseURL).toString(),
      supportedVersions,
      getHeader: makeHeaderGetter(headers),
      getBody: makeBodyGetter(ctx.method, ctx.body),

      setResponseHeader: (key: string, value: string) => {
        responseHeaders[key] = value;
      },

      sendJSONResponse: (status, body, headers) => {
        const merged = { ...responseHeaders, ...headers };
        const resp: GatewayRequestResult = { status };
        if (Object.keys(merged).length > 0) resp.headers = merged;
        if (body) resp.body = body;
        return resp;
      },

      body: async (context) => {
        const lookup = lookupBindingForContext(
          context,
          schemeIndex,
          methodIndex,
        );
        if (!lookup) {
          // The middleware matched a payment to a handler but we have
          // no binding for its scheme/method. This is a configuration
          // bug rather than a client error: a binding's handler
          // advertised capabilities that the binding index doesn't
          // know about.
          throw new Error(
            "gateway received a payment for a scheme/method with no " +
              "matching binding — internal configuration error",
          );
        }

        const authResult =
          lookup.kind === "x402"
            ? x402[x402States.indexOf(lookup.state)]
            : mpp[mppStates.indexOf(lookup.state)];
        if (!authResult || !authResult.matched) {
          // The middleware advertised pricing this binding didn't
          // produce — same internal-error reasoning as above.
          throw new Error(
            "gateway dispatched to a binding that did not advertise " +
              "pricing for this request — internal configuration error",
          );
        }
        dispatchedRule = authResult;

        // The binding's matched rule decides phase. Rule with
        // `authorize` runs as two-phase (verify now, settle at
        // /response). Rule without runs as one-phase (settle now).
        const twoPhase = authResult.hasAuthorize === true;

        if (twoPhase) {
          if (!("verify" in context && context.verify)) {
            // Two-phase rule but the chosen handler does not
            // implement verify. Under the binding model this means
            // the binding's pricing was misconfigured — the rule
            // promised authorize+capture but the handler only
            // supports settle. Fail loud so the operator notices.
            throw new Error(
              "binding rule has authorize but the chosen handler does " +
                "not implement verify — binding misconfigured",
            );
          }
          switch (context.protocolVersion) {
            case 1: {
              const r = await context.verify();
              if (!r.success) return r.errorResponse;
              authorizeResponse = {
                protocol: "x402v1",
                verification: r.facilitatorResponse,
              };
              break;
            }
            case 2: {
              const r = await context.verify();
              if (!r.success) return r.errorResponse;
              authorizeResponse = {
                protocol: "x402v2",
                verification: r.facilitatorResponse,
              };
              break;
            }
            case "mpp": {
              const r = await context.verify();
              if (!r.success) return r.errorResponse;
              authorizeResponse = {
                protocol: "mpp",
                verification: r.receipt,
              };
              break;
            }
            default: {
              const _: never = context;
              break;
            }
          }
        } else {
          // One-phase: settle immediately.
          switch (context.protocolVersion) {
            case 1: {
              const r = await context.settle();
              if (!r.success) return r.errorResponse;
              settledPayment = {
                protocol: "x402v1",
                settlement: r.facilitatorResponse,
              };
              break;
            }
            case 2: {
              const r = await context.settle();
              if (!r.success) return r.errorResponse;
              settledPayment = {
                protocol: "x402v2",
                settlement: r.facilitatorResponse,
              };
              break;
            }
            case "mpp": {
              const r = await context.settle();
              if (!r.success) return r.errorResponse;
              settledPayment = {
                protocol: "mpp",
                settlement: r.receipt,
              };
              break;
            }
            default: {
              const _: never = context;
              break;
            }
          }
          settledAtRequest = true;
        }

        const resp: GatewayRequestResult = { status: 200 };
        if (Object.keys(responseHeaders).length > 0) {
          resp.headers = { ...responseHeaders };
        }
        return resp;
      },
    });

    if (onAuthorize && authorizeResponse) {
      try {
        await onAuthorize(ctx.operationKey, authorizeResponse);
      } catch (cause) {
        logger.error("onAuthorize hook threw", {
          operationKey: ctx.operationKey,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    if (onCapture && settledAtRequest && dispatchedRule) {
      const trace: EvalTrace | undefined =
        dispatchedRule.trace &&
        dispatchedRule.ruleIndex !== undefined &&
        dispatchedRule.rule
          ? {
              ruleIndex: dispatchedRule.ruleIndex,
              rule: dispatchedRule.rule,
              capture: dispatchedRule.trace,
            }
          : undefined;
      const capture: CaptureResponse = {
        phase: "request",
        settled: true,
        amount: amountToJSON(dispatchedRule.amount),
        request: { method: ctx.method, path: ctx.path, headers },
      };
      if (settledPayment) {
        capture.payment = settledPayment;
      }
      if (trace) {
        capture.trace = trace;
      }
      try {
        await onCapture(ctx.operationKey, capture);
      } catch (cause) {
        logger.error("onCapture hook threw", {
          operationKey: ctx.operationKey,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    return result ?? { status: 200 };
  }

  async function handleResponse(
    ctx: ResponseContext,
  ): Promise<GatewayResponseResult> {
    const headers = normalizeHeaderMap(ctx.headers);
    const query = normalizeHeaderMap(ctx.query);
    const responseHeaders = normalizeHeaderMap(ctx.response.headers);
    const body = requireBody(ctx.body, ctx.method, "handleResponse");
    const evalCtx = withResponse(
      buildContext({ body, headers, query, path: ctx.path }),
      {
        body: ctx.response.body,
        headers: responseHeaders,
        status: ctx.response.status,
      },
    );

    // Re-evaluate authorize-phase pricing so we can match the chosen
    // binding back to its rule (needed for trace) and reproduce the
    // accepts list for the middleware. Authorize is request-only, so
    // the same evaluation that produced /request's pricing produces
    // it here.
    const reqEvalCtx = buildContext({
      body,
      headers,
      query,
      path: ctx.path,
    });
    const reqResults = evaluateAllAuthorize(ctx.operationKey, reqEvalCtx);

    if (reqResults.pricing.length === 0) {
      // No binding produced pricing; nothing to settle.
      return { status: 200 };
    }

    let paymentSettled = false;
    let settlementError: CaptureError | undefined;
    let settledPayment: SettledPayment | undefined;
    let dispatchedBindingState: X402BindingState | MPPBindingState | undefined;
    let captureResultForBinding: PriceResult | undefined;
    let authResultForBinding: PriceResult | undefined;

    await handleMiddlewareRequest<GatewayResponseResult>({
      x402Handlers: bindings.map((b) => b.handler),
      mppMethodHandlers: mppBindings.map((b) => b.handler),
      pricing: reqResults.pricing,
      resource: new URL(ctx.path, baseURL).toString(),
      supportedVersions,
      getHeader: makeHeaderGetter(headers),
      getBody: makeBodyGetter(ctx.method, ctx.body),
      setResponseHeader: (_key: string, _value: string) => {
        // no-op
      },
      sendJSONResponse: (status) => ({ status }),

      body: async (context) => {
        const lookup = lookupBindingForContext(
          context,
          schemeIndex,
          methodIndex,
        );
        if (!lookup) {
          throw new Error(
            "gateway received a payment for a scheme/method with no " +
              "matching binding at /response — internal configuration error",
          );
        }
        dispatchedBindingState = lookup.state;

        const idx =
          lookup.kind === "x402"
            ? x402States.indexOf(lookup.state)
            : mppStates.indexOf(lookup.state);
        const authResult =
          lookup.kind === "x402" ? reqResults.x402[idx] : reqResults.mpp[idx];
        if (!authResult || !authResult.matched) {
          throw new Error(
            "gateway dispatched at /response to a binding that did not " +
              "advertise pricing — internal configuration error",
          );
        }
        authResultForBinding = authResult;

        if (!authResult.hasAuthorize) {
          // One-phase: /request already settled. Nothing to do here.
          return { status: 200 };
        }

        // Two-phase: evaluate the binding's capture against the
        // response and settle the captured amount.
        captureResultForBinding = lookup.state.evaluator.capture(
          ctx.operationKey,
          evalCtx,
        );

        const capturePricing = toPricing(
          captureResultForBinding.amount,
          spec.assets,
        );
        if (capturePricing.length === 0) {
          // Zero capture: nothing to settle.
          paymentSettled = true;
          return { status: 200 };
        }

        switch (context.protocolVersion) {
          case 1: {
            const r = await context.settle();
            paymentSettled = r.success;
            if (!r.success) {
              settlementError = toCaptureError(
                r.errorResponse.status,
                r.errorMessage,
              );
            } else {
              settledPayment = {
                protocol: "x402v1",
                settlement: r.facilitatorResponse,
              };
            }
            break;
          }
          case 2: {
            const r = await context.settle();
            paymentSettled = r.success;
            if (!r.success) {
              settlementError = toCaptureError(
                r.errorResponse.status,
                r.errorMessage,
              );
            } else {
              settledPayment = {
                protocol: "x402v2",
                settlement: r.facilitatorResponse,
              };
            }
            break;
          }
          case "mpp": {
            const r = await context.settle();
            paymentSettled = r.success;
            if (!r.success) {
              settlementError = toCaptureError(
                r.errorResponse.status,
                r.errorMessage,
              );
            } else {
              settledPayment = {
                protocol: "mpp",
                settlement: r.receipt,
              };
            }
            break;
          }
          default: {
            const _: never = context;
            break;
          }
        }
        return { status: paymentSettled ? 200 : 500 };
      },
    });

    // If the dispatched binding's rule was one-phase, /response has
    // nothing further to do — settlement already happened at /request.
    if (
      dispatchedBindingState &&
      authResultForBinding &&
      !authResultForBinding.hasAuthorize
    ) {
      return { status: 200 };
    }

    if (
      !dispatchedBindingState ||
      !authResultForBinding ||
      !captureResultForBinding
    ) {
      // No dispatch happened (no payment header), or two-phase capture
      // ran but produced zero amount. In either case there is no
      // capture event to fire.
      return { status: paymentSettled ? 200 : 500 };
    }

    const trace: EvalTrace | undefined =
      captureResultForBinding.trace &&
      captureResultForBinding.ruleIndex !== undefined &&
      captureResultForBinding.rule
        ? {
            ruleIndex: captureResultForBinding.ruleIndex,
            rule: captureResultForBinding.rule,
            capture: captureResultForBinding.trace,
            ...(authResultForBinding.hasAuthorize && authResultForBinding.trace
              ? { authorize: authResultForBinding.trace }
              : {}),
          }
        : undefined;

    const hasCaptureAmount = Object.values(captureResultForBinding.amount).some(
      (v) => v > 0n,
    );
    const settlementAttempted = paymentSettled || settlementError !== undefined;
    if (onCapture && hasCaptureAmount && settlementAttempted) {
      const capture: CaptureResponse = {
        phase: "response",
        settled: paymentSettled,
        amount: amountToJSON(captureResultForBinding.amount),
        request: { method: ctx.method, path: ctx.path, headers },
      };
      if (settledPayment) {
        capture.payment = settledPayment;
      }
      if (settlementError !== undefined) {
        capture.error = settlementError;
      }
      if (trace) {
        capture.trace = trace;
      }
      try {
        await onCapture(ctx.operationKey, capture);
      } catch (cause) {
        logger.error("onCapture hook threw", {
          operationKey: ctx.operationKey,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    return { status: paymentSettled ? 200 : 500 };
  }

  return { handleRequest, handleResponse };
}
