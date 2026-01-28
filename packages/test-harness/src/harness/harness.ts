import { Hono } from "hono";
import { createFacilitatorRoutes } from "@faremeter/facilitator";
import { wrap } from "@faremeter/fetch";
import {
  handleMiddlewareRequest,
  getPaymentRequiredResponse,
} from "@faremeter/middleware/common";
import type { MiddlewareBodyContext } from "@faremeter/middleware/common";
import type { PaymentExecer } from "@faremeter/types/client";
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
        resource: c.req.url,
        fetch: middlewareFetch,
        getHeader: (key: string) => c.req.header(key),
        setResponseHeader: (key: string, value: string) => c.header(key, value),
        getPaymentRequiredResponse,
        sendJSONResponse: (
          status: 402,
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
   * @param opts.payerChooser - Function to choose which payment option to use
   */
  createFetch(opts?: {
    payerChooser?:
      | ((execers: PaymentExecer[]) => PaymentExecer | Promise<PaymentExecer>)
      | undefined;
  }): typeof fetch {
    const clientFetch = this.createClientFetch();

    const payerChooser = opts?.payerChooser;

    return wrap(clientFetch, {
      handlers: this.config.clientHandlers,
      ...(payerChooser
        ? {
            payerChooser: async (execers: PaymentExecer[]) =>
              payerChooser(execers),
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
