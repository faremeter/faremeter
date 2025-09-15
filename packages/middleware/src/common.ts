import {
  type x402PaymentRequirements,
  type x402PaymentPayload,
  isValidationError,
  x402PaymentRequiredResponse,
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

type getPaymentRequiredResponseArgs = {
  facilitatorURL: string;
  accepts: RelaxedRequirements[];
  resource: string;
};

export async function getPaymentRequiredResponse(
  args: getPaymentRequiredResponseArgs,
) {
  const accepts = args.accepts.map((x) => ({
    ...x,
    resource: x.resource ?? args.resource,
  }));

  const t = await fetch(`${args.facilitatorURL}/accepts`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      x402Version: 1,
      accepts,
    }),
  });

  gateGetPaymentRequiredResponse(t);

  const response = x402PaymentRequiredResponse(await t.json());

  if (isValidationError(response)) {
    throw new Error(
      `invalid payment requirements from facilitator: ${response.summary}`,
    );
  }

  return response;
}
