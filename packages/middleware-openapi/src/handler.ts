import { type } from "arktype";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { MPPMethodHandler, mppReceipt } from "@faremeter/types/mpp";
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
} from "@faremeter/middleware/common";
import { createPricingEvaluator } from "./evaluator";
import { buildContext, withResponse } from "./context";
import { logger } from "./logger";
import type { Asset, EvalTrace, FaremeterSpec, PriceResult } from "./types";

export type GatewayHandlerConfig = {
  spec: FaremeterSpec;
  baseURL: string;
  x402Handlers?: FacilitatorHandler[];
  mppMethodHandlers?: MPPMethodHandler[];
  supportedVersions?: SupportedVersionsConfig;
  /**
   * Called post-settlement when a pricing rule matched and produced
   * a non-empty capture amount. `result.phase` indicates whether
   * settlement happened at `/request` (one-phase) or `/response`
   * (two-phase).
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
   *
   * Requires payment handlers (`x402Handlers` or `mppMethodHandlers`)
   * to be configured. Without them no settlement occurs and this
   * hook is never invoked.
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

// Headers and query values can arrive as arrays when the same name
// appears more than once in the original HTTP message (the Lua
// gateway's `access.lua` uses `array_aware()` to preserve multi-value
// fields as arrays rather than lossy comma joins — see RFC 7230
// §3.2.2). The schema accepts the union so that a request carrying a
// multi-value header (e.g. repeated `Cookie`) is not rejected at the
// /request or /response validation boundary. `normalizeHeaderMap`
// below flattens arrays into `, `-joined strings before the
// evaluator ever sees them, so the internal code paths continue to
// see `Record<string, string>`.
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

/**
 * HTTP methods that per-spec do not carry a request body. A `null`
 * body on these methods is legitimate (GET has no body, DELETE
 * usually has no body, etc.) — the gateway forwards `body: null`
 * and the handler treats it as an empty object for JSONPath
 * evaluation purposes.
 */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE", "OPTIONS"]);

/**
 * Normalize the request body that the handler was given into a
 * non-null object suitable for JSONPath evaluation. Body-less HTTP
 * methods (GET, HEAD, DELETE, OPTIONS) are allowed to arrive with
 * `body: null` and are coerced to `{}`. Body-carrying methods
 * (POST, PUT, PATCH) must supply a JSON object: a `null` body on
 * those methods indicates the gateway could not decode the
 * client's body, which would silently bypass any rule whose match
 * references `$.request.body.*` — fail loudly instead.
 */
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
    // Zero-amount entries are dropped so that a rule priced at zero
    // (e.g. `authorize: "0"`) falls through to the unpaid path instead
    // of triggering a 402 for a zero-cost payment.
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

/**
 * Join multi-value headers/query params into a single string per
 * key, matching RFC 9110 §5.3's rule that multiple field-lines with
 * the same field-name can be combined with `, ` into a single
 * field-value. The sidecar's internal eval context works with
 * single-string values; arrays from the wire format are flattened
 * here at the handler boundary so downstream code (the JSONPath
 * evaluator, the payment middleware's `getHeader` lookup) doesn't
 * need to branch on the shape.
 */
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

export function createGatewayHandler(
  config: GatewayHandlerConfig,
): GatewayHandler {
  const {
    spec,
    baseURL,
    x402Handlers = [],
    mppMethodHandlers = [],
    onCapture,
    onAuthorize,
  } = config;
  if (!baseURL) {
    throw new Error("createGatewayHandler: baseURL is required");
  }
  const anyRules = Object.values(spec.operations).some(
    (op) => (op.rules?.length ?? 0) > 0,
  );
  if (anyRules && x402Handlers.length === 0 && mppMethodHandlers.length === 0) {
    logger.warning(
      "createGatewayHandler: spec defines pricing rules but no payment " +
        "handlers were provided; /request can still advertise 402 pricing " +
        "but no settlement will occur on /response",
    );
  }
  const supportedVersions = resolveSupportedVersions(config.supportedVersions);
  const evaluator = createPricingEvaluator(spec);

  async function handleRequest(
    ctx: RequestContext,
  ): Promise<GatewayRequestResult> {
    const headers = normalizeHeaderMap(ctx.headers);
    const query = normalizeHeaderMap(ctx.query);
    const body = requireBody(ctx.body, ctx.method, "handleRequest");
    const evalCtx = buildContext({
      body,
      headers,
      query,
      path: ctx.path,
    });

    const authResult = evaluator.authorize(ctx.operationKey, evalCtx);

    if (!authResult.matched) {
      logger.debug("authorize: no rule matched", {
        operationKey: ctx.operationKey,
      });
      return { status: 200 };
    }

    const pricing = toPricing(authResult.amount, spec.assets);
    if (pricing.length === 0) {
      logger.debug("authorize: matched but priced at zero", {
        operationKey: ctx.operationKey,
      });
      return { status: 200 };
    }

    const responseHeaders: Record<string, string> = {};
    let settledAtRequest = false;
    let settledPayment: SettledPayment | undefined;
    let authorizeResponse: AuthorizeResponse | undefined;

    const result = await handleMiddlewareRequest<GatewayRequestResult>({
      x402Handlers,
      mppMethodHandlers,
      pricing,
      resource: new URL(ctx.path, baseURL).toString(),
      supportedVersions,
      getHeader: makeHeaderGetter(headers),
      getBody: makeBodyGetter(ctx.method, ctx.body),

      setResponseHeader: (key: string, value: string) => {
        responseHeaders[key] = value;
      },

      sendJSONResponse: (
        status: number,
        body?: object,
        headers?: Record<string, string>,
      ) => {
        const merged = { ...responseHeaders, ...headers };
        const resp: GatewayRequestResult = { status };
        if (Object.keys(merged).length > 0) resp.headers = merged;
        if (body) resp.body = body;
        return resp;
      },

      body: async (context) => {
        if (authResult.hasAuthorize && "verify" in context && context.verify) {
          // authorize + capture: verify the payment now, settle
          // later at /response with the captured amount.
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
          // capture only, or the payment scheme does not support
          // verify: settle immediately.
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

    if (onCapture && settledAtRequest) {
      // For one-phase rules the evaluator falls back to the capture
      // expression when computing authorize, so authResult.trace IS
      // the capture trace here.
      const trace: EvalTrace | undefined =
        authResult.trace &&
        authResult.ruleIndex !== undefined &&
        authResult.rule
          ? {
              ruleIndex: authResult.ruleIndex,
              rule: authResult.rule,
              capture: authResult.trace,
            }
          : undefined;
      const capture: CaptureResponse = {
        phase: "request",
        settled: true,
        amount: amountToJSON(authResult.amount),
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
      buildContext({
        body,
        headers,
        query,
        path: ctx.path,
      }),
      {
        body: ctx.response.body,
        headers: responseHeaders,
        status: ctx.response.status,
      },
    );

    const captureResult = evaluator.capture(ctx.operationKey, evalCtx);

    const authEvalCtx = buildContext({
      body,
      headers,
      query,
      path: ctx.path,
    });
    const authResult: PriceResult = evaluator.authorize(
      ctx.operationKey,
      authEvalCtx,
    );

    if (!authResult.matched) {
      return { status: 200 };
    }

    let paymentSettled = false;
    let settlementError: CaptureError | undefined;
    let settledPayment: SettledPayment | undefined;
    // Set when an MPP handler without handleVerify is encountered at
    // /response. This means /request already settled as one-phase, so
    // /response must skip settlement entirely (no double-charge, no
    // second onCapture fire).
    let alreadySettledAtRequest = false;

    if (authResult.hasAuthorize) {
      // authorize + capture: settle the captured amount now.
      // Capture-only rules already settled at /request.
      const pricing = toPricing(captureResult.amount, spec.assets);
      if (pricing.length === 0) {
        // Captured amount is zero — no payment needed. toPricing
        // drops zero-amount entries, so there is nothing to settle.
        paymentSettled = true;
      } else {
        await handleMiddlewareRequest<GatewayResponseResult>({
          x402Handlers,
          mppMethodHandlers,
          pricing,
          resource: new URL(ctx.path, baseURL).toString(),
          supportedVersions,
          getHeader: makeHeaderGetter(headers),
          getBody: makeBodyGetter(ctx.method, ctx.body),
          setResponseHeader: (_key: string, _value: string) => {
            // no-op during settlement
          },
          sendJSONResponse: (status) => ({ status }),

          body: async (context) => {
            // If the spec rule has authorize but the payment scheme
            // did not support verify (e.g. MPP handler without
            // handleVerify), /request already settled as one-phase.
            // Skip settlement here to avoid double-charging.
            if (
              context.protocolVersion === "mpp" &&
              !("verify" in context && context.verify)
            ) {
              alreadySettledAtRequest = true;
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
      }
    }

    if (!authResult.hasAuthorize || alreadySettledAtRequest) {
      // One-phase rule (or MPP handler without handleVerify that
      // settled as one-phase at /request): settlement already happened
      // at /request time. The response phase has nothing to do.
      return { status: 200 };
    }

    const trace: EvalTrace | undefined =
      captureResult.trace &&
      captureResult.ruleIndex !== undefined &&
      captureResult.rule
        ? {
            ruleIndex: captureResult.ruleIndex,
            rule: captureResult.rule,
            capture: captureResult.trace,
            ...(authResult.hasAuthorize && authResult.trace
              ? { authorize: authResult.trace }
              : {}),
          }
        : undefined;

    const hasCaptureAmount = Object.values(captureResult.amount).some(
      (v) => v > 0n,
    );
    const settlementAttempted = paymentSettled || settlementError !== undefined;
    if (onCapture && hasCaptureAmount && settlementAttempted) {
      const capture: CaptureResponse = {
        phase: "response",
        settled: paymentSettled,
        amount: amountToJSON(captureResult.amount),
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
