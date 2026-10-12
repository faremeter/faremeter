import { type RequestContext } from "@faremeter/types/client";

import type { MPPPaymentHandler } from "@faremeter/types/mpp";
import { computeBodyDigest } from "@faremeter/types/mpp";

import {
  type ProcessPaymentRequiredResponseOpts,
  processPaymentRequiredResponse,
  processPaymentRequiredResponseMPP,
  X_PAYMENT_HEADER,
  V2_PAYMENT_HEADER,
} from "./internal";
import { createRequestReplay } from "./request-replay";

/**
 * Error thrown when payment fails after exhausting all retry attempts.
 * Contains the final 402 response for inspection.
 */
export class WrappedFetchError extends Error {
  constructor(
    message: string,
    /** The final 402 response after all retry attempts failed. */
    public response: Response,
  ) {
    super(message);
  }
}

/**
 * Configuration options for wrapping a fetch function with x402 payment handling.
 */
export type WrapOpts = ProcessPaymentRequiredResponseOpts & {
  /** MPP payment handlers for Authorization: Payment flow. */
  mppHandlers?: MPPPaymentHandler[];
  /** Optional fetch function for the initial request (phase 1). Defaults to phase2Fetch. */
  phase1Fetch?: typeof fetch;
  /** Number of retry attempts after initial failure. Defaults to 2. */
  retryCount?: number;
  /** Initial delay between retries in milliseconds. Doubles after each attempt. Defaults to 100. */
  initialRetryDelay?: number;
  /** If true, returns the 402 response instead of throwing on payment failure. */
  returnPaymentFailure?: boolean;
};

/**
 * Wraps a fetch function with automatic x402 payment handling.
 *
 * When a 402 Payment Required response is received, the wrapper automatically
 * processes the payment requirements, executes payment via the configured handlers,
 * and retries the request with the payment header attached.
 * Request inputs retain their effective headers and body, including init overrides,
 * across payment attempts. Consumed body bytes are buffered for replay.
 * Each attempt can cancel its body independently. A body used by the returned
 * response remains readable until its consumer finishes or cancels it.
 *
 * @param phase2Fetch - The fetch function to use for the paid request (phase 2)
 * @param options - Configuration including payment handlers and retry settings
 * @returns A wrapped fetch function with the same signature as native fetch
 */
export function wrap(phase2Fetch: typeof fetch, options: WrapOpts) {
  return async (
    input: RequestInfo | URL,
    fetchOptions: RequestInit | null = {},
  ) => {
    const init = fetchOptions ?? {};
    const mayPay =
      options.handlers.length > 0 ||
      (options.mppHandlers?.length ?? 0) > 0 ||
      options.payerChooser !== undefined;
    const request =
      input instanceof Request && mayPay ? new Request(input, init) : undefined;
    const replay = request && mayPay ? createRequestReplay(request) : undefined;
    const { body: _body, headers: _headers, ...requestInit } = init;
    const fetchInit = request
      ? {
          ...requestInit,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
        }
      : init;
    async function fetchAttempt(transport: typeof fetch, init: RequestInit) {
      const attemptInput = replay ? await replay.createRequest() : input;
      return await transport(attemptInput, init);
    }

    async function getBodyDigest() {
      let bodyBuffer: ArrayBuffer | null = null;
      if (request?.body && replay) {
        bodyBuffer = await replay.readBody();
      } else if (init.body !== null && init.body !== undefined) {
        if (typeof init.body === "string") {
          bodyBuffer = new TextEncoder().encode(init.body).buffer;
        } else if (init.body instanceof ArrayBuffer) {
          bodyBuffer = init.body;
        } else if (ArrayBuffer.isView(init.body)) {
          const view = init.body;
          bodyBuffer = view.buffer.slice(
            view.byteOffset,
            view.byteOffset + view.byteLength,
          );
        }
      }
      if (bodyBuffer !== null && bodyBuffer.byteLength > 0) {
        return await computeBodyDigest(bodyBuffer);
      }
      return undefined;
    }

    async function makeRequest() {
      const response = await fetchAttempt(
        options.phase1Fetch ?? phase2Fetch,
        fetchInit,
      );

      if (response.status !== 402) {
        return response;
      }
      replay?.throwIfFailed();

      // Try MPP first (checks WWW-Authenticate header, does not consume body)
      if (options.mppHandlers && options.mppHandlers.length > 0) {
        const authorizationHeader = await processPaymentRequiredResponseMPP(
          response,
          options.mppHandlers,
          { getBodyDigest },
        );
        if (authorizationHeader) {
          const headers = new Headers(request?.headers ?? init.headers);
          headers.set("Authorization", authorizationHeader);
          return await fetchAttempt(phase2Fetch, {
            ...fetchInit,
            headers,
          });
        }
      }

      // Fall through to x402
      const ctx: RequestContext = {
        request: input,
      };

      const { paymentHeader, detectedVersion } =
        await processPaymentRequiredResponse(ctx, response, options);

      const headers = new Headers(request?.headers ?? init.headers);
      const headerName =
        detectedVersion === 2 ? V2_PAYMENT_HEADER : X_PAYMENT_HEADER;
      headers.set(headerName, paymentHeader);

      const secondResponse = await fetchAttempt(phase2Fetch, {
        ...fetchInit,
        headers,
      });
      return secondResponse;
    }

    async function run() {
      let attempt = (options.retryCount ?? 2) + 1;
      let backoff = options.initialRetryDelay ?? 100;
      let response: Response;

      do {
        response = await makeRequest();

        if (response.status != 402) {
          return response;
        }

        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff *= 2;
      } while (--attempt > 0);

      if (options.returnPaymentFailure) {
        return response;
      }

      throw new WrappedFetchError(
        "failed to complete payment after retries",
        response,
      );
    }
    try {
      const response = await run();
      replay?.dispose();
      return response;
    } catch (error) {
      replay?.dispose(!(error instanceof WrappedFetchError));
      throw error;
    }
  };
}
