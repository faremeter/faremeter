import type {
  x402PaymentRequirements,
  x402PaymentPayload,
} from "@faremeter/types";

import { logger } from "./logger";

export function findMatchingPaymentRequirements(
  accepts: x402PaymentRequirements[],
  payload: x402PaymentPayload,
) {
  // XXX - This is naive, and doesn't consider `asset` because that information
  // isn't available here.
  return accepts.find(
    (x) => x.network === payload.network && x.scheme === payload.scheme,
  );
}

export function gateGetPaymentRequiredResponse(res: Response) {
  if (res.status === 200) {
    return;
  }

  const msg = `received a non success response to requirements request from facilitator: ${res.statusText} (${res.status})`;

  logger.error(msg);
  throw new Error(msg);
}
