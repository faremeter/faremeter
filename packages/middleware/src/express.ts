import {
  type FacilitatorHandler,
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
};
export function createDirectFacilitatorMiddleware(
  args: CreateDirectFacilitatorMiddlewareArgs,
) {
  const sendPaymentRequired = async (res: Response) => {
    const accepts: x402PaymentRequirements[] = (
      await Promise.all(args.handlers.flatMap((x) => x.getRequirements()))
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

    // XXX - We need a better policy than "first one wins".
    for (const handler of args.handlers) {
      const t = await handler.handleSettle(payment);

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
