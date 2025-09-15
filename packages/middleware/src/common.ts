import type {
  x402PaymentRequirements,
  x402PaymentPayload,
} from "@faremeter/types";

import { logger } from "./logger";

export function findMatchingPaymentRequirements(
  accepts: x402PaymentRequirements[],
  payload: x402PaymentPayload,
) {
  let possible;

  if (payload.asset !== undefined) {
    // Narrow based on the asset if available.
    possible = accepts.filter(
      (x) =>
        x.network === payload.network &&
        x.scheme === payload.scheme &&
        x.asset === payload.asset,
    );
  } else {
    // Otherwise fall back to the behavior in coinbase/x402.
    possible = accepts.filter(
      (x) => x.network === payload.network && x.scheme === payload.scheme,
    );
  }

  if (possible.length > 1) {
    logger.warning(
      `found ${possible.length} ambiguous matching requirements for client payment: {*}`,
      payload,
    );
  }

  // XXX - If there are more than one, this really should be an error.
  // For now, err on the side of potential compatibility.
  return possible[0];
}

export function gateGetPaymentRequiredResponse(res: Response) {
  if (res.status === 200) {
    return;
  }

  const msg = `received a non success response to requirements request from facilitator: ${res.statusText} (${res.status})`;

  logger.error(msg);
  throw new Error(msg);
}

export type RelaxedRequirements = Partial<x402PaymentRequirements>;
