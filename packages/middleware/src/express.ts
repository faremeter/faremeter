import {
  type FacilitatorHandler,
  x402SettleRequest,
  x402SettleResponse,
  x402PaymentRequiredResponse,
  x402PaymentRequirements,
  x402PaymentHeaderToPayload,
  isValidationError,
} from "@faremeter/types";
import { findMatchingPaymentRequirements } from "./utils";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

function extractPaymentFromHeader(req: Request) {
  const paymentHeader = req.header("X-PAYMENT");
  if (!paymentHeader) {
    return null;
  }

  const payload = x402PaymentHeaderToPayload(paymentHeader);
  if (isValidationError(payload)) {
    logger.info(`type validation error: ${payload.summary}`);
    return null;
  }

  return payload;
}

type CreateDirectFacilitatorMiddlewareArgs = {
  handlers: FacilitatorHandler[];
  accepts: x402PaymentRequirements[];
};
export function createDirectFacilitatorMiddleware(
  args: CreateDirectFacilitatorMiddlewareArgs,
) {
  const sendPaymentRequired = async (res: Response) => {
    const accepts: x402PaymentRequirements[] = (
      await Promise.all(
        args.handlers.flatMap((x) => x.getRequirements(args.accepts)),
      )
    ).flat();

    res.status(402).json({
      x402Version: 1,
      accepts,
    });
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    const payment = extractPaymentFromHeader(req);

    if (!payment) {
      return sendPaymentRequired(res);
    }

    const paymentRequirements = findMatchingPaymentRequirements(
      args.accepts,
      payment,
    );

    if (!paymentRequirements) {
      return sendPaymentRequired(res);
    }

    // XXX - We need a better policy than "first one wins".
    for (const handler of args.handlers) {
      const t = await handler.handleSettle(paymentRequirements, payment);

      if (t === null) {
        continue;
      }

      if (t.success) {
        next();
        return;
      }
    }

    return sendPaymentRequired(res);
  };
}

type CreateMiddlewareArgs = {
  accepts: x402PaymentRequirements[];
  facilitatorURL: string;
};

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

export async function createMiddleware(args: CreateMiddlewareArgs) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // XXX - Temporarily request this every time.  This will be
    // cached in future.
    const paymentRequiredResponse = await getPaymentRequiredResponse(args);
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
