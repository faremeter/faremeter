import {
  type FacilitatorHandler,
  headerToX402PaymentPayload,
  isValidationError,
} from "@faremeter/types";
import type { NextFunction, Request, Response } from "express";

function extractPaymentFromHeader(req: Request) {
  const paymentHeader = req.header("X-PAYMENT");
  if (!paymentHeader) {
    return null;
  }

  const payload = headerToX402PaymentPayload(paymentHeader);
  if (isValidationError(payload)) {
    console.log("type validation error:", payload.summary);
    return null;
  }

  return payload;
}

export function createDirectFacilitatorMiddleware(handler: FacilitatorHandler) {
  const sendPaymentRequired = async (res: Response) => {
    res.status(402).json({
      x402Version: 1,
      accepts: await handler.getRequirements(),
    });
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    const payment = extractPaymentFromHeader(req);

    if (!payment) {
      return sendPaymentRequired(res);
    }

    const settleRes = handler.handleSettle(payment);

    if (!settleRes) {
      return sendPaymentRequired(res);
    }

    next();
  };
}
