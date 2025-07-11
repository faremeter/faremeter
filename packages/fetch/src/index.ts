import {
  type PaymentExecer,
  type RequestContext,
  type PaymentHandler,
  PaymentRequiredResponse,
} from "./types";
import { isValidationError, throwValidationError } from "./validation";

type WrapOptions = {
  handlers: PaymentHandler[];
  payerChooser?: (execer: PaymentExecer[]) => Promise<PaymentExecer>;
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

export function wrap(wrappedFetch: typeof fetch, options: WrapOptions) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const response = await fetch(input, init);

    if (response.status !== 402) {
      return response;
    }

    const payerChooser = options.payerChooser ?? chooseFirstAvailable;

    const payResp = PaymentRequiredResponse(await response.json());

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

    const newInit: RequestInit = {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...payerResult.headers,
      },
    };

    const secondResponse = await wrappedFetch(input, newInit);
    return secondResponse;
  };
}
