import { isValidationError } from "@faremeter/types";
import {
  type x402PaymentRequirements,
  type x402PaymentPayload,
  x402PaymentRequiredResponse,
  x402PaymentHeaderToPayload,
  x402SettleRequest,
  x402SettleResponse,
} from "@faremeter/types/x402";

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

type PossibleStatusCodes = 402;
type PossibleJSONResponse = object;

export type CommonMiddlewareArgs = {
  facilitatorURL: string;
  accepts: RelaxedRequirements[];
};

export type HandleMiddlewareRequestArgs<MiddlewareResponse = unknown> =
  CommonMiddlewareArgs & {
    resource: string;
    getHeader: (key: string) => string | undefined;
    getPaymentRequiredResponse: typeof getPaymentRequiredResponse;
    sendJSONResponse: (
      status: PossibleStatusCodes,
      obj: PossibleJSONResponse,
    ) => MiddlewareResponse;
  };

export async function handleMiddlewareRequest<MiddlewareResponse>(
  args: HandleMiddlewareRequestArgs<MiddlewareResponse>,
) {
  // XXX - Temporarily request this every time.  This will be
  // cached in future.
  const paymentRequiredResponse = await args.getPaymentRequiredResponse(args);

  const sendPaymentRequired = () =>
    args.sendJSONResponse(402, paymentRequiredResponse);

  const paymentHeader = args.getHeader("X-PAYMENT");

  if (!paymentHeader) {
    return sendPaymentRequired();
  }

  const payload = x402PaymentHeaderToPayload(paymentHeader);

  if (isValidationError(payload)) {
    logger.debug(`couldn't validate client payload: ${payload.summary}`);
    return sendPaymentRequired();
  }

  const paymentRequirements = findMatchingPaymentRequirements(
    paymentRequiredResponse.accepts,
    payload,
  );

  if (!paymentRequirements) {
    logger.warning(
      `couldn't find matching payment requirements for payload`,
      payload,
    );
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
    const msg = `error getting response from facilitator for settlement: ${settlementResponse.summary}`;
    logger.error(msg);
    throw new Error(msg);
  }

  if (!settlementResponse.success) {
    logger.warning("failed to settle payment: {error}", settlementResponse);
    return sendPaymentRequired();
  }
}
