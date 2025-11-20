import { isValidationError } from "@faremeter/types";
import {
  type x402PaymentRequirements,
  type x402PaymentPayload,
  x402PaymentRequiredResponse,
  x402PaymentHeaderToPayload,
  x402VerifyRequest,
  x402VerifyResponse,
  x402SettleRequest,
  x402SettleResponse,
} from "@faremeter/types/x402";
import { type AgedLRUCacheOpts, AgedLRUCache } from "./cache";

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
  accepts: (RelaxedRequirements | RelaxedRequirements[])[];
  cacheConfig?: createPaymentRequiredResponseCacheOpts;
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
    body: (context: {
      paymentRequirements: x402PaymentRequirements;
      paymentPayload: x402PaymentPayload;
      settle: () => Promise<MiddlewareResponse | undefined>;
      verify: () => Promise<MiddlewareResponse | undefined>;
    }) => Promise<MiddlewareResponse | undefined>;
  };

export async function handleMiddlewareRequest<MiddlewareResponse>(
  args: HandleMiddlewareRequestArgs<MiddlewareResponse>,
) {
  const accepts = args.accepts.flat();

  const paymentRequiredResponse = await args.getPaymentRequiredResponse({
    accepts,
    facilitatorURL: args.facilitatorURL,
    resource: args.resource,
  });

  const sendPaymentRequired = () =>
    args.sendJSONResponse(402, paymentRequiredResponse);

  const paymentHeader = args.getHeader("X-PAYMENT");

  if (!paymentHeader) {
    return sendPaymentRequired();
  }

  const paymentPayload = x402PaymentHeaderToPayload(paymentHeader);

  if (isValidationError(paymentPayload)) {
    logger.debug(`couldn't validate client payload: ${paymentPayload.summary}`);
    return sendPaymentRequired();
  }

  const paymentRequirements = findMatchingPaymentRequirements(
    paymentRequiredResponse.accepts,
    paymentPayload,
  );

  if (!paymentRequirements) {
    logger.warning(
      `couldn't find matching payment requirements for payload`,
      paymentPayload,
    );
    return sendPaymentRequired();
  }

  const settle = async () => {
    const settleRequest: x402SettleRequest = {
      x402Version: 1,
      paymentHeader,
      paymentPayload,
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
  };

  const verify = async () => {
    const verifyRequest: x402VerifyRequest = {
      x402Version: 1,
      paymentHeader,
      paymentPayload,
      paymentRequirements,
    };

    const t = await fetch(`${args.facilitatorURL}/verify`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(verifyRequest),
    });
    const verifyResponse = x402VerifyResponse(await t.json());

    if (isValidationError(verifyResponse)) {
      const msg = `error getting response from facilitator for verification: ${verifyResponse.summary}`;
      logger.error(msg);
      throw new Error(msg);
    }

    if (!verifyResponse.isValid) {
      logger.warning(
        "failed to settle payment: {invalidReason}",
        verifyResponse,
      );
      return sendPaymentRequired();
    }
  };

  return await args.body({
    paymentRequirements,
    paymentPayload,
    settle,
    verify,
  });
}

export type createPaymentRequiredResponseCacheOpts = AgedLRUCacheOpts & {
  disable?: boolean;
};
export function createPaymentRequiredResponseCache(
  opts: createPaymentRequiredResponseCacheOpts = {},
) {
  if (opts.disable) {
    logger.warning("payment required response cache disabled");

    return {
      getPaymentRequiredResponse,
    };
  }

  const cache = new AgedLRUCache<
    RelaxedRequirements[],
    x402PaymentRequiredResponse
  >(opts);

  return {
    getPaymentRequiredResponse: async (
      args: getPaymentRequiredResponseArgs,
    ) => {
      let response = cache.get(args.accepts);

      if (response === undefined) {
        response = await getPaymentRequiredResponse(args);

        cache.put(args.accepts, response);
      }

      return response;
    },
  };
}
