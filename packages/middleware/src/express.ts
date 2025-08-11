import {
  type FacilitatorHandler,
  x402SettleRequest,
  x402SettleResponse,
  x402PaymentRequiredResponse,
  x402PaymentRequirements,
  x402PaymentHeaderToPayload,
  isValidationError,
} from "@faremeter/types";
import type { NextFunction, Request, Response } from "express";

function extractPaymentFromHeader(req: Request) {
  const paymentHeader = req.header("X-PAYMENT");
  if (!paymentHeader) {
    return null;
  }

  const payload = x402PaymentHeaderToPayload(paymentHeader);
  if (isValidationError(payload)) {
    console.log("type validation error:", payload.summary);
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

    // XXX - This is naive, and doesn't consider `asset` because that information
    // isn't available here.
    const paymentRequirements = args.accepts.filter(
      (x) => x.network === payment.network && x.scheme === payment.scheme,
    )[0];

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
  const cachedPaymentRequirements = await getPaymentRequiredResponse(args);
  const sendPaymentRequired = async (res: Response) => {
    res.status(402).json(cachedPaymentRequirements);
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.header("X-PAYMENT");
    if (!paymentHeader) {
      return sendPaymentRequired(res);
    }

    const payload = x402PaymentHeaderToPayload(paymentHeader);

    if (isValidationError(payload)) {
      return sendPaymentRequired(res);
    }

    // XXX - This is naive, and doesn't consider `asset` because that information
    // isn't available here.
    const paymentRequirements = cachedPaymentRequirements.accepts.filter(
      (x) => x.network === payload.network && x.scheme === payload.scheme,
    )[0];

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
    const v = await t.json();
    const settlementResponse = x402SettleResponse(v);

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
