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
import type { Asset, FaremeterSpec, PriceResult } from "./types";

export type GatewayHandlerConfig = {
  spec: FaremeterSpec;
  baseURL?: string;
  x402Handlers?: FacilitatorHandler[];
  mppMethodHandlers?: MPPMethodHandler[];
  supportedVersions?: SupportedVersionsConfig;
};

export const requestContext = type({
  operationKey: "string",
  method: "string",
  path: "string",
  headers: "Record<string, string>",
  query: "Record<string, string>",
  body: "Record<string, unknown> | null",
});

export type RequestContext = typeof requestContext.infer;

export const responseContext = type({
  operationKey: "string",
  method: "string",
  path: "string",
  headers: "Record<string, string>",
  query: "Record<string, string>",
  body: "Record<string, unknown> | null",
  response: {
    status: "number",
    headers: "Record<string, string>",
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
};

function coerceBody(
  body: Record<string, unknown> | null,
): Record<string, unknown> {
  return body ?? {};
}

function toPricing(
  amount: Record<string, bigint>,
  assets: Record<string, Asset>,
): ResourcePricing[] {
  return Object.entries(amount).flatMap(([name, qty]) => {
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

function hasAmounts(amount: Record<string, bigint>): boolean {
  return Object.keys(amount).length > 0;
}

export function createGatewayHandler(config: GatewayHandlerConfig) {
  const {
    spec,
    baseURL = "http://gateway",
    x402Handlers = [],
    mppMethodHandlers = [],
  } = config;
  const supportedVersions = resolveSupportedVersions(config.supportedVersions);
  const evaluator = createPricingEvaluator(spec);

  async function handleRequest(ctx: RequestContext): Promise<GatewayResponse> {
    const evalCtx = buildContext({
      body: coerceBody(ctx.body),
      headers: ctx.headers,
      query: ctx.query,
      path: ctx.path,
    });

    let authResult: PriceResult;
    try {
      authResult = evaluator.authorize(ctx.operationKey, evalCtx);
    } catch {
      return { status: 500 };
    }

    if (!authResult.matched) {
      return { status: 200 };
    }

    const pricing = toPricing(authResult.amount, spec.assets);
    if (pricing.length === 0) {
      return { status: 200 };
    }

    const responseHeaders: Record<string, string> = {};

    const result = await handleMiddlewareRequest<GatewayResponse>({
      x402Handlers,
      mppMethodHandlers,
      pricing,
      resource: new URL(ctx.path, baseURL).toString(),
      supportedVersions,
      getHeader: makeHeaderGetter(ctx.headers),
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
        if (context.protocolVersion === "mpp") {
          const settleResult = await context.settle();
          if (!settleResult.success) {
            return settleResult.errorResponse;
          }
        } else {
          const verifyResult = await context.verify();
          if (!verifyResult.success) {
            return verifyResult.errorResponse;
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
    const evalCtx = withResponse(
      buildContext({
        body: coerceBody(ctx.body),
        headers: ctx.headers,
        query: ctx.query,
        path: ctx.path,
      }),
      {
        body: ctx.response.body,
        headers: ctx.response.headers,
        status: ctx.response.status,
      },
    );

    let captureResult: PriceResult;
    let authResult: PriceResult;
    try {
      captureResult = evaluator.capture(ctx.operationKey, evalCtx);

      const authEvalCtx = buildContext({
        body: coerceBody(ctx.body),
        headers: ctx.headers,
        query: ctx.query,
        path: ctx.path,
      });
      authResult = evaluator.authorize(ctx.operationKey, authEvalCtx);
    } catch {
      return { captured: false, settled: false, amount: {} };
    }
    let paymentSettled = false;

    if (authResult.matched) {
      const settlementAmount = hasAmounts(captureResult.amount)
        ? captureResult.amount
        : authResult.amount;

      const pricing = toPricing(settlementAmount, spec.assets);
      if (pricing.length > 0) {
        await handleMiddlewareRequest<GatewayResponse>({
          x402Handlers,
          mppMethodHandlers,
          pricing,
          resource: new URL(ctx.path, baseURL).toString(),
          supportedVersions,
          getHeader: makeHeaderGetter(ctx.headers),
          getBody: makeBodyGetter(ctx.method, ctx.body),
          setResponseHeader: (_key: string, _value: string) => {
            // no-op during settlement
          },
          sendJSONResponse: (status) => ({ status }),

          body: async (context) => {
            const settleResult = await context.settle();
            paymentSettled = settleResult.success;
            return { status: paymentSettled ? 200 : 500 };
          },
        });
      }
    }

    return {
      captured: Object.keys(captureResult.amount).length > 0,
      settled: paymentSettled,
      amount: amountToJSON(captureResult.amount),
    };
  }

  return { handleRequest, handleResponse };
}
