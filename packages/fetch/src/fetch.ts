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
};

export function wrap(phase2Fetch: typeof fetch, options: WrapOpts) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    async function makeRequest() {
      const response = await (options.phase1Fetch ?? phase2Fetch)(input, init);

      if (response.status !== 402) {
        return response;
      }

      const ctx: RequestContext = {
        request: input,
      };

      const { paymentHeader } = await processPaymentRequiredResponse(
        ctx,
        await response.json(),
        options,
      );

      const headers = new Headers(init.headers);
      headers.set("X-PAYMENT", paymentHeader);

      const newInit: RequestInit = {
        ...init,
        headers,
      };

      const secondResponse = await phase2Fetch(input, newInit);
      return secondResponse;
    }

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
  };
}
