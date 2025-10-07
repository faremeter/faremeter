import { isValidationError, throwValidationError } from "@faremeter/types";

import {
  type PaymentExecer,
  type RequestContext,
  type PaymentHandler,
} from "@faremeter/types/client";

import {
  x402PaymentRequiredResponse,
  type x402PaymentPayload,
} from "@faremeter/types/x402";

type WrapOptions = {
  handlers: PaymentHandler[];
  payerChooser?: (execer: PaymentExecer[]) => Promise<PaymentExecer>;
  phase1Fetch?: typeof fetch;
};

export function chooseFirstAvailable(
  possiblePayers: PaymentExecer[],
): PaymentExecer {
  if (possiblePayers.length < 1) {
    throw new Error("no applicable payers found");
  }

  const payer = possiblePayers[0];

  if (payer === undefined) {
    throw new Error("undefined payer found");
  }

  return payer;
}

export function wrap(phase2Fetch: typeof fetch, options: WrapOptions) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const response = await (options.phase1Fetch ?? phase2Fetch)(input, init);

    if (response.status !== 402) {
      return response;
    }

    const payerChooser = options.payerChooser ?? chooseFirstAvailable;

    const payResp = x402PaymentRequiredResponse(await response.json());

    if (isValidationError(payResp)) {
      throwValidationError("couldn't parse payment required response", payResp);
    }

    const ctx: RequestContext = {
      request: input,
    };

    const possiblePayers: PaymentExecer[] = [];

    for (const h of options.handlers) {
      possiblePayers.push(...(await h(ctx, payResp.accepts)));
    }

    const payer = await payerChooser(possiblePayers);
    const payerResult = await payer.exec();

    const payload: x402PaymentPayload = {
      x402Version: payResp.x402Version,
      scheme: payer.requirements.scheme,
      network: payer.requirements.network,
      asset: payer.requirements.asset,
      payload: payerResult.payload,
    };

    const xPaymentHeader = btoa(JSON.stringify(payload));
    const headers = new Headers(init.headers);
    headers.set("X-PAYMENT", xPaymentHeader);

    const newInit: RequestInit = {
      ...init,
      headers,
    };

    const secondResponse = await phase2Fetch(input, newInit);
    return secondResponse;
  };
}
