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
  verbose?: boolean;
};

export async function processPaymentRequiredResponse(
  ctx: RequestContext,
  response: unknown,
  options: ProcessPaymentRequiredResponseOpts,
) {
  const verbose = options.verbose ?? false;
  const payerChooser = options.payerChooser ?? chooseFirstAvailable;

  if (verbose) {
    console.log("[x402] Processing payment required response...");
  }

  const payResp = x402PaymentRequiredResponse(response);

  if (isValidationError(payResp)) {
    if (verbose) {
      console.log("[x402] Validation error parsing payment response:", payResp);
    }
    throwValidationError("couldn't parse payment required response", payResp);
  }

  if (verbose) {
    console.log("[x402] Parsed payment response:", {
      x402Version: payResp.x402Version,
      acceptsCount: payResp.accepts.length,
      accepts: payResp.accepts,
    });
  }

  const possiblePayers: PaymentExecer[] = [];

  if (verbose) {
    console.log("[x402] Checking handlers for applicable payers...");
  }

  for (const h of options.handlers) {
    const payers = await h(ctx, payResp.accepts);
    if (verbose) {
      console.log("[x402] Handler returned payers:", payers.length);
    }
    possiblePayers.push(...payers);
  }

  if (verbose) {
    console.log("[x402] Total possible payers found:", possiblePayers.length);
    if (possiblePayers.length > 0) {
      console.log(
        "[x402] Payer options:",
        possiblePayers.map((p) => ({
          scheme: p.requirements.scheme,
          network: p.requirements.network,
          asset: p.requirements.asset,
        })),
      );
    }
  }

  const payer = await payerChooser(possiblePayers);

  if (verbose) {
    console.log("[x402] Selected payer:", {
      scheme: payer.requirements.scheme,
      network: payer.requirements.network,
      asset: payer.requirements.asset,
    });
    console.log("[x402] Executing payment...");
  }

  const payerResult = await payer.exec();

  if (verbose) {
    console.log("[x402] Payment execution completed");
  }

  const paymentPayload: x402PaymentPayload = {
    x402Version: payResp.x402Version,
    scheme: payer.requirements.scheme,
    network: payer.requirements.network,
    asset: payer.requirements.asset,
    payload: payerResult.payload,
  };

  const paymentHeader = btoa(JSON.stringify(paymentPayload));

  if (verbose) {
    console.log("[x402] Payment payload created:", {
      x402Version: paymentPayload.x402Version,
      scheme: paymentPayload.scheme,
      network: paymentPayload.network,
      asset: paymentPayload.asset,
    });
  }

  return {
    payer,
    payerResult,
    paymentPayload,
    paymentHeader,
  };
}
