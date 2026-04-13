import { type } from "arktype";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { MPPMethodHandler } from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";
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
};

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

export type GatewayResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type CaptureResponse = {
  captured: boolean;
  settled: boolean;
  amount: Record<string, string>;
  // When settlement is attempted and fails, the facilitator's
  // machine-readable error payload is propagated here. Absent for
  // successful settlements and for one-phase rules where authorize
  // and capture produce the same amount.
  error?: unknown;
  trace?: EvalTrace;
};

export type GatewayHandler = {
  handleRequest(ctx: RequestContext): Promise<GatewayResponse>;
  handleResponse(ctx: ResponseContext): Promise<CaptureResponse>;
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
  const { spec, baseURL, x402Handlers = [], mppMethodHandlers = [] } = config;
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

  async function handleRequest(ctx: RequestContext): Promise<GatewayResponse> {
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

    const result = await handleMiddlewareRequest<GatewayResponse>({
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
        const resp: GatewayResponse = { status };
        if (Object.keys(merged).length > 0) resp.headers = merged;
        if (body) resp.body = body;
        return resp;
      },

      body: async (context) => {
        if (authResult.hasAuthorize && "verify" in context) {
          // authorize + capture: verify the payment now, settle
          // later at /response with the captured amount.
          const verifyResult = await context.verify();
          if (!verifyResult.success) {
            return verifyResult.errorResponse;
          }
        } else {
          // capture only, or the payment scheme does not support
          // verify: settle immediately.
          const settleResult = await context.settle();
          if (!settleResult.success) {
            return settleResult.errorResponse;
          }
        }
        const resp: GatewayResponse = { status: 200 };
        if (Object.keys(responseHeaders).length > 0) {
          resp.headers = { ...responseHeaders };
        }
        return resp;
      },
    });

    return result ?? { status: 200 };
  }

  async function handleResponse(
    ctx: ResponseContext,
  ): Promise<CaptureResponse> {
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

    let paymentSettled = false;
    let settlementError: unknown;

    if (authResult.matched && authResult.hasAuthorize) {
      // authorize + capture: settle the captured amount now.
      // Capture-only rules already settled at /request.
      const pricing = toPricing(captureResult.amount, spec.assets);
      if (pricing.length > 0) {
        await handleMiddlewareRequest<GatewayResponse>({
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
            const settleResult = await context.settle();
            paymentSettled = settleResult.success;
            if (!settleResult.success) {
              settlementError = settleResult.errorResponse;
            }
            return { status: paymentSettled ? 200 : 500 };
          },
        });
      }
    }

    if (
      !paymentSettled &&
      !settlementError &&
      authResult.matched &&
      !authResult.hasAuthorize
    ) {
      // One-phase rule: settlement already happened at /request time.
      // If handleResponse is called, the request succeeded (200), so
      // settlement succeeded. Only set settled if a non-zero amount
      // was actually captured (zero amounts are filtered by toPricing
      // and skip settlement entirely).
      paymentSettled = Object.values(captureResult.amount).some((v) => v > 0n);
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

    const response: CaptureResponse = {
      captured: Object.keys(captureResult.amount).length > 0,
      settled: paymentSettled,
      amount: amountToJSON(captureResult.amount),
    };
    if (settlementError !== undefined) {
      response.error = settlementError;
    }
    if (trace) {
      response.trace = trace;
    }
    return response;
  }

  return { handleRequest, handleResponse };
}
