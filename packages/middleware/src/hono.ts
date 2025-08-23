import {
  x402SettleRequest,
  x402SettleResponse,
  x402PaymentRequiredResponse,
  x402PaymentRequirements,
  x402PaymentHeaderToPayload,
  isValidationError,
} from "@faremeter/types";
import { findMatchingPaymentRequirements } from "./utils";

import type { MiddlewareHandler } from "hono";

type CreateMiddlewareArgs = {
  accepts: x402PaymentRequirements[];
  facilitatorURL: string;
};

export async function createMiddleware(
  args: CreateMiddlewareArgs,
): Promise<MiddlewareHandler> {
  async function getPaymentRequiredResponse(args: CreateMiddlewareArgs) {
    const t = await fetch(`${args.facilitatorURL}/accepts`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        x402Version: 1,
        accepts: args.accepts,
      }),
    });

    const response = x402PaymentRequiredResponse(await t.json());

    if (isValidationError(response)) {
      throw new Error(
        `invalid payment requirements from facilitator: ${response.summary}`,
      );
    }

    return response;
  }

  return async (c, next) => {
    // XXX - Temporarily request this every time.  This will be
    // cached in future.
    const paymentRequiredResponse = await getPaymentRequiredResponse(args);
    const sendPaymentRequired = () => {
      c.status(402);
      return c.json(paymentRequiredResponse);
    };

    const paymentHeader = c.req.header("X-PAYMENT");
    if (!paymentHeader) {
      return sendPaymentRequired();
    }

    const payload = x402PaymentHeaderToPayload(paymentHeader);

    if (isValidationError(payload)) {
      return sendPaymentRequired();
    }

    const paymentRequirements = findMatchingPaymentRequirements(
      paymentRequiredResponse.accepts,
      payload,
    );

    if (!paymentRequirements) {
      return sendPaymentRequired();
    }

    const settleRequest: x402SettleRequest = {
      x402Version: 1,
      paymentHeader,
      paymentRequirements,
    };

    const t = await fetch(`${args.facilitatorURL}/settle`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settleRequest),
    });
    const settlementResponse = x402SettleResponse(await t.json());

    if (isValidationError(settlementResponse)) {
      throw new Error(
        `error getting response from facilitator for settlement: ${settlementResponse.summary}`,
      );
    }

    if (!settlementResponse.success) {
      return sendPaymentRequired();
    }

    await next();
  };
}
