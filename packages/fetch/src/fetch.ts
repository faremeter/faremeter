import { type RequestContext } from "@faremeter/types/client";

import {
  type ProcessPaymentRequiredResponseOpts,
  processPaymentRequiredResponse,
} from "./internal";

export class WrappedFetchError extends Error {
  constructor(
    message: string,
    public response: Response,
  ) {
    super(message);
  }
}

export type WrapOpts = ProcessPaymentRequiredResponseOpts & {
  phase1Fetch?: typeof fetch;
  retryCount?: number;
  initialRetryDelay?: number;
  returnPaymentFailure?: boolean;
  verbose?: boolean;
};

export function wrap(phase2Fetch: typeof fetch, options: WrapOpts) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const verbose = options.verbose ?? false;

    if (verbose) {
      console.log("[x402] Starting request:", {
        url: input instanceof URL ? input.href : input,
        method: init.method ?? "GET",
      });
    }

    async function makeRequest() {
      if (verbose) {
        console.log("[x402] Sending initial request...");
      }

      const response = await (options.phase1Fetch ?? phase2Fetch)(input, init);

      if (verbose) {
        console.log("[x402] Received response:", {
          status: response.status,
          statusText: response.statusText,
        });
      }

      if (response.status !== 402) {
        if (verbose) {
          console.log("[x402] No payment required, returning response");
        }
        return response;
      }

      if (verbose) {
        console.log(
          "[x402] Payment required (402), processing payment response...",
        );
      }

      const ctx: RequestContext = {
        request: input,
      };

      const responseJson = await response.json();

      if (verbose) {
        console.log(
          "[x402] Payment required response:",
          JSON.stringify(responseJson, null, 2),
        );
      }

      const { paymentHeader, paymentPayload, payer } =
        await processPaymentRequiredResponse(ctx, responseJson, options);

      if (verbose) {
        console.log("[x402] Payment processed:", {
          scheme: paymentPayload.scheme,
          network: paymentPayload.network,
          asset: paymentPayload.asset,
          payerRequirements: payer.requirements,
        });
        console.log(
          "[x402] Payment header generated (base64 length):",
          paymentHeader.length,
        );
      }

      const headers = new Headers(init.headers);
      headers.set("X-PAYMENT", paymentHeader);

      const newInit: RequestInit = {
        ...init,
        headers,
      };

      if (verbose) {
        console.log("[x402] Resending request with payment header...");
      }

      const secondResponse = await phase2Fetch(input, newInit);

      if (verbose) {
        console.log("[x402] Second response received:", {
          status: secondResponse.status,
          statusText: secondResponse.statusText,
        });
      }

      return secondResponse;
    }

    let attempt = (options.retryCount ?? 2) + 1;
    let backoff = options.initialRetryDelay ?? 100;
    let response: Response;

    if (verbose) {
      console.log("[x402] Starting retry loop:", {
        maxAttempts: attempt,
        initialRetryDelay: backoff,
      });
    }

    do {
      const attemptNumber = attempt;
      if (verbose && attemptNumber < (options.retryCount ?? 2) + 1) {
        console.log(
          `[x402] Retry attempt ${(options.retryCount ?? 2) + 2 - attemptNumber}...`,
        );
      }

      response = await makeRequest();

      if (response.status != 402) {
        if (verbose) {
          console.log("[x402] Request successful, returning response");
        }
        return response;
      }

      if (verbose) {
        console.log("[x402] Still receiving 402, will retry after backoff:", {
          backoffMs: backoff,
          remainingAttempts: attempt - 1,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff *= 2;
    } while (--attempt > 0);

    if (verbose) {
      console.log("[x402] All retry attempts exhausted");
    }

    if (options.returnPaymentFailure) {
      if (verbose) {
        console.log("[x402] Returning payment failure response");
      }
      return response;
    }

    if (verbose) {
      console.log("[x402] Throwing WrappedFetchError");
    }

    throw new WrappedFetchError(
      "failed to complete payment after retries",
      response,
    );
  };
}
