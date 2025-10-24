import {
  type PaymentExecer,
  type RequestContext,
  type PaymentHandler,
} from "@faremeter/types/client";

import {
  x402PaymentRequiredResponse,
  type x402PaymentPayload,
} from "@faremeter/types/x402";

import { isValidationError, throwValidationError } from "@faremeter/types";

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

export type ProcessPaymentRequiredResponseOpts = {
  handlers: PaymentHandler[];
  payerChooser?: (execer: PaymentExecer[]) => Promise<PaymentExecer>;
};

export async function processPaymentRequiredResponse(
  ctx: RequestContext,
  response: unknown,
  options: ProcessPaymentRequiredResponseOpts,
) {
  const payerChooser = options.payerChooser ?? chooseFirstAvailable;

  const payResp = x402PaymentRequiredResponse(response);

  if (isValidationError(payResp)) {
    throwValidationError("couldn't parse payment required response", payResp);
  }

  const possiblePayers: PaymentExecer[] = [];

  for (const h of options.handlers) {
    possiblePayers.push(...(await h(ctx, payResp.accepts)));
  }

  const payer = await payerChooser(possiblePayers);
  const payerResult = await payer.exec();

  const paymentPayload: x402PaymentPayload = {
    x402Version: payResp.x402Version,
    scheme: payer.requirements.scheme,
    network: payer.requirements.network,
    asset: payer.requirements.asset,
    payload: payerResult.payload,
  };

  const paymentHeader = btoa(JSON.stringify(paymentPayload));

  return {
    payer,
    payerResult,
    paymentPayload,
    paymentHeader,
  };
}
