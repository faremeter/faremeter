import { Hono } from "hono";
import { createFacilitatorRoutes } from "@faremeter/facilitator";
import { wrap } from "@faremeter/fetch";
import {
  handleMiddlewareRequest,
  getPaymentRequiredResponse,
  getPaymentRequiredResponseV2,
  resolveSupportedVersions,
} from "@faremeter/middleware/common";
import type {
  MiddlewareBodyContext,
  MiddlewareBodyContextV1,
} from "@faremeter/middleware/common";
import type { PaymentExecer, PaymentExecerV1 } from "@faremeter/types/client";
import { adaptRequirementsV2ToV1 } from "@faremeter/types/x402-adapters";
import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402VerifyResponse,
} from "@faremeter/types/x402";
import type { Interceptor } from "../interceptors/types";
import { composeInterceptors } from "../interceptors/types";
import { getURLFromRequestInfo } from "../interceptors/utils";
import type { TestHarnessConfig, SettleMode } from "./config";
import type { ResourceHandler, ResourceContext } from "./resource";
import { defaultResourceHandler } from "./resource";

/**
 * Internal state tracked during a request for resource handler context.
 */
type RequestState = {
  paymentRequirements?: x402PaymentRequirements | undefined;
  paymentPayload?: x402PaymentPayload | undefined;
  settleResponse?: x402SettleResponse | undefined;
  verifyResponse?: x402VerifyResponse | undefined;
};

/**
 * Type guard to check if a middleware context is v1.
 */
function isV1Context<T>(
  context: MiddlewareBodyContext<T>,
): context is MiddlewareBodyContextV1<T> {
  return context.protocolVersion === 1;
}

/**
 * TestHarness provides an in-process test environment for the x402 protocol.
 *
 * It connects client, middleware, and facilitator using function adapters
 * instead of HTTP, allowing full protocol testing without network calls.
 */
export class TestHarness {
  /**
   * The internal Hono app containing facilitator and middleware routes.
   */
  readonly app: Hono;

  private readonly config: TestHarnessConfig;
  private readonly settleMode: SettleMode;
  private resourceHandler: ResourceHandler = defaultResourceHandler;
  private clientInterceptors: Interceptor[] = [];
  private middlewareInterceptors: Interceptor[] = [];

  /**
   * Base URL used for internal routing.
   */
  private readonly baseUrl = "http://test-harness";

  constructor(config: TestHarnessConfig) {
    this.config = config;
    this.settleMode = config.settleMode ?? "settle-only";
    this.clientInterceptors = [...(config.clientInterceptors ?? [])];
    this.middlewareInterceptors = [...(config.middlewareInterceptors ?? [])];

    this.app = this.createApp();
  }

  /**
   * Create the internal Hono app with facilitator and resource routes.
   */
  private createApp(): Hono {
    const app = new Hono();

    // Suppress error logging in test harness - errors are expected in tests
    // and should be converted to 500 responses without stack traces
    app.onError((err, c) => {
      return c.json({ error: err.message }, 500);
    });

    // Mount facilitator routes
    const facilitatorRoutes = createFacilitatorRoutes({
      handlers: this.config.facilitatorHandlers,
    });
    app.route("/facilitator", facilitatorRoutes);

    // Resource routes are handled dynamically via the middleware
    // We use a catch-all that applies payment middleware
    app.all("/*", async (c) => {
      // Create a fetch for middleware->facilitator calls that:
      // 1. Applies middleware interceptors
      // 2. Routes to the Hono app
      const middlewareFetch = this.createMiddlewareFetch();

      // Track state for resource handler
      const state: RequestState = {};

      const result = await handleMiddlewareRequest<Response>({
        facilitatorURL: `${this.baseUrl}/facilitator`,
        accepts: this.config.accepts,
        supportedVersions: resolveSupportedVersions(
          this.config.supportedVersions,
        ),
        resource: c.req.url,
        fetch: middlewareFetch,
        getHeader: (key: string) => c.req.header(key),
        setResponseHeader: (key: string, value: string) => c.header(key, value),
        getPaymentRequiredResponse,
        getPaymentRequiredResponseV2,
        sendJSONResponse: (
          status: 400 | 402,
          body?: object,
          headers?: Record<string, string>,
        ): Response => {
          c.status(status);
          if (headers) {
            for (const [key, value] of Object.entries(headers)) {
              c.header(key, value);
            }
          }
          if (body) {
            return c.json(body);
          }
          return c.body(null);
        },
        body: async (
          context: MiddlewareBodyContext<Response>,
        ): Promise<Response | undefined> => {
          // Test harness currently only supports v1 protocol
          if (!isV1Context(context)) {
            c.status(501);
            return c.json({
              error: "Test harness does not yet support x402 v2 protocol",
            });
          }

          const { paymentRequirements, paymentPayload, settle, verify } =
            context;

          // Store for resource handler
          state.paymentRequirements = paymentRequirements;
          state.paymentPayload = paymentPayload;

          if (this.settleMode === "verify-then-settle") {
            const verifyResult = await verify();
            if (!verifyResult.success) {
              return verifyResult.errorResponse;
            }
            state.verifyResponse = verifyResult.facilitatorResponse;

            const settleResult = await settle();
            if (!settleResult.success) {
              return settleResult.errorResponse;
            }
            state.settleResponse = settleResult.facilitatorResponse;
          } else {
            const settleResult = await settle();
            if (!settleResult.success) {
              return settleResult.errorResponse;
            }
            state.settleResponse = settleResult.facilitatorResponse;
          }

          // Payment successful - call resource handler
          const ctx: ResourceContext = {
            resource: c.req.url,
            request: c.req.raw,
            paymentRequirements,
            paymentPayload,
            settleResponse: state.settleResponse,
            verifyResponse: state.verifyResponse,
          };

          const resourceResult = await this.resourceHandler(ctx);

          // Set response headers
          if (resourceResult.headers) {
            for (const [key, value] of Object.entries(resourceResult.headers)) {
              c.header(key, value);
            }
          }

          c.status(resourceResult.status as 200);
          return c.json(resourceResult.body as object);
        },
      });

      return result;
    });

    return app;
  }

  /**
   * Create a fetch function for middleware->facilitator calls.
   * This applies middleware interceptors and routes to the Hono app.
   */
  private createMiddlewareFetch(): typeof fetch {
    const baseFetch: typeof fetch = async (input, init) => {
      const url = getURLFromRequestInfo(input);
      // Route to our Hono app
      const path = url.replace(this.baseUrl, "");
      return this.app.request(path, init);
    };

    if (this.middlewareInterceptors.length === 0) {
      return baseFetch;
    }

    return composeInterceptors(...this.middlewareInterceptors)(baseFetch);
  }

  /**
   * Create a fetch function for client->middleware calls.
   * This applies client interceptors and routes to the Hono app.
   */
  private createClientFetch(): typeof fetch {
    const baseFetch: typeof fetch = async (input, init) => {
      const url = getURLFromRequestInfo(input);
      // Route to our Hono app - strip any base URL
      let path = url;
      if (path.startsWith("http://") || path.startsWith("https://")) {
        const urlObj = new URL(path);
        path = urlObj.pathname + urlObj.search;
      }
      return this.app.request(path, init);
    };

    if (this.clientInterceptors.length === 0) {
      return baseFetch;
    }

    return composeInterceptors(...this.clientInterceptors)(baseFetch);
  }

  /**
   * Set the resource handler that responds after successful payment.
   */
  setResourceHandler(handler: ResourceHandler): void {
    this.resourceHandler = handler;
  }

  /**
   * Create a fetch function that handles the full x402 payment flow.
   *
   * @param opts.payerChooser - Function to choose which payment option to use.
   *   Receives v1 PaymentExecerV1[] for compatibility with v1 protocol tests.
   *   The chosen execer is converted back to v2 internally.
   */
  createFetch(opts?: {
    payerChooser?:
      | ((
          execers: PaymentExecerV1[],
        ) => PaymentExecerV1 | Promise<PaymentExecerV1>)
      | undefined;
  }): typeof fetch {
    const clientFetch = this.createClientFetch();

    const payerChooser = opts?.payerChooser;

    return wrap(clientFetch, {
      handlers: this.config.clientHandlers,
      ...(payerChooser
        ? {
            payerChooser: async (
              v2Execers: PaymentExecer[],
            ): Promise<PaymentExecer> => {
              // Convert v2 execers to v1 for the callback
              const v1Execers: PaymentExecerV1[] = v2Execers.map((e) => ({
                requirements: adaptRequirementsV2ToV1(e.requirements, {
                  url: "",
                }),
                exec: e.exec,
              }));

              // Let the callback choose using v1 types
              const chosenV1 = await payerChooser(v1Execers);

              // Find the corresponding v2 execer by matching requirements
              const chosenIndex = v1Execers.indexOf(chosenV1);
              if (chosenIndex >= 0) {
                const v2Execer = v2Execers[chosenIndex];
                if (v2Execer) {
                  return v2Execer;
                }
              }

              // Fallback: wrap the v1 execer's exec with the first matching v2 requirements
              const matchingV2 = v2Execers.find(
                (e) =>
                  e.requirements.scheme === chosenV1.requirements.scheme &&
                  e.requirements.network === chosenV1.requirements.network &&
                  e.requirements.asset === chosenV1.requirements.asset,
              );
              if (matchingV2) {
                return {
                  requirements: matchingV2.requirements,
                  exec: chosenV1.exec,
                };
              }

              // Last resort: return first v2 execer with the chosen exec
              const first = v2Execers[0];
              if (!first) {
                throw new Error("No execers available");
              }
              return { requirements: first.requirements, exec: chosenV1.exec };
            },
          }
        : {}),
    });
  }

  /**
   * Add an interceptor to the client chain (between test code and middleware).
   */
  addClientInterceptor(interceptor: Interceptor): void {
    this.clientInterceptors.push(interceptor);
  }

  /**
   * Add an interceptor to the middleware chain (between middleware and facilitator).
   */
  addMiddlewareInterceptor(interceptor: Interceptor): void {
    this.middlewareInterceptors.push(interceptor);
  }

  /**
   * Clear all interceptors added after construction.
   */
  clearInterceptors(): void {
    this.clientInterceptors = [...(this.config.clientInterceptors ?? [])];
    this.middlewareInterceptors = [
      ...(this.config.middlewareInterceptors ?? []),
    ];
  }

  /**
   * Reset harness state (interceptors, resource handler).
   */
  reset(): void {
    this.clearInterceptors();
    this.resourceHandler = defaultResourceHandler;
  }
}
