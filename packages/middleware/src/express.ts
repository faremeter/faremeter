import {
  x402SettleRequest,
  x402SettleResponse,
  x402PaymentHeaderToPayload,
  isValidationError,
} from "@faremeter/types";
import {
  findMatchingPaymentRequirements,
  getPaymentRequiredResponse,
  type RelaxedRequirements,
} from "./common";
import type { NextFunction, Request, Response } from "express";

type CreateMiddlewareArgs = {
  accepts: RelaxedRequirements[];
  facilitatorURL: string;
};

export async function createMiddleware(args: CreateMiddlewareArgs) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentRequiredResponse = await getPaymentRequiredResponse({
      ...args,
      resource: `${req.protocol}://${req.headers.host}${req.path}`,
    });

    // XXX - Temporarily request this every time.  This will be
    // cached in future.
    const sendPaymentRequired = (res: Response) => {
      res.status(402).json(paymentRequiredResponse);
    };

    const paymentHeader = req.header("X-PAYMENT");
    if (!paymentHeader) {
      return sendPaymentRequired(res);
    }

    const payload = x402PaymentHeaderToPayload(paymentHeader);

    if (isValidationError(payload)) {
      return sendPaymentRequired(res);
    }

    const paymentRequirements = findMatchingPaymentRequirements(
      paymentRequiredResponse.accepts,
      payload,
    );

    if (!paymentRequirements) {
      return sendPaymentRequired(res);
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
      return sendPaymentRequired(res);
    }

    next();
  };
}
