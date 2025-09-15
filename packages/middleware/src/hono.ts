import {
  x402SettleRequest,
  x402SettleResponse,
  x402PaymentHeaderToPayload,
  isValidationError,
} from "@faremeter/types";
import {
  findMatchingPaymentRequirements,
  type RelaxedRequirements,
  getPaymentRequiredResponse,
} from "./common";

import type { MiddlewareHandler } from "hono";

type CreateMiddlewareArgs = {
  accepts: RelaxedRequirements[];
  facilitatorURL: string;
};

export async function createMiddleware(
  args: CreateMiddlewareArgs,
): Promise<MiddlewareHandler> {
  return async (c, next) => {
    // XXX - Temporarily request this every time.  This will be
    // cached in future.
    const paymentRequiredResponse = await getPaymentRequiredResponse({
      ...args,
      resource: c.req.url,
    });
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
