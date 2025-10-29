import { getLogger } from "@logtape/logtape";
import { Hono, type Context } from "hono";
import * as x from "@faremeter/types/x402";
import { isValidationError } from "@faremeter/types";
import { type x402PaymentRequirements } from "@faremeter/types/x402";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import { allSettledWithTimeout } from "./promise";

const logger = getLogger(["faremeter", "facilitator"]);

type CreateFacilitatorRoutesArgs = {
  handlers: FacilitatorHandler[];
  timeout?: {
    getRequirements?: number;
    getSupported?: number;
  };
};

type StatusCode = 400 | 500;

function summarizeRequirements({
  scheme,
  network,
  asset,
  payTo,
}: x402PaymentRequirements) {
  return {
    scheme,
    network,
    asset,
    payTo,
  };
}

export function createFacilitatorRoutes(args: CreateFacilitatorRoutesArgs) {
  const router = new Hono();

  function sendSettleError(
    c: Context,
    status: StatusCode,
    msg: string | undefined,
  ) {
    const response: x.x402SettleResponse = {
      success: false,
      txHash: null,
      networkId: null,
    };

    if (msg !== undefined) {
      response.error = msg;
      logger.error(msg);
    } else {
      logger.error("unknown error during settlement");
    }

    c.status(status);
    return c.json(response);
  }

  router.post("/settle", async (c) => {
    const x402Req = x.x402SettleRequest(await c.req.json());

    if (isValidationError(x402Req)) {
      return sendSettleError(
        c,
        400,
        `couldn't validate request: ${x402Req.summary}`,
      );
    }

    const paymentPayload = x.x402PaymentHeaderToPayload(x402Req.paymentHeader);

    if (isValidationError(paymentPayload)) {
      return sendSettleError(
        c,
        400,
        `couldn't validate x402 payload: ${paymentPayload.summary}`,
      );
    }

    logger.debug("starting settlement attempt for request: {*}", x402Req);

    for (const handler of args.handlers) {
      let t;

      try {
        t = await handler.handleSettle(
          x402Req.paymentRequirements,
          paymentPayload,
        );
      } catch (e) {
        let msg = undefined;

        // XXX - We can do a better job of determining if it's a chain
        // error, or some other issue.
        if (e instanceof Error) {
          msg = e.message;
        } else {
          msg = "unknown error handling settlement";
        }

        return sendSettleError(c, 500, msg);
      }

      if (t === null) {
        continue;
      }

      logger.debug(
        "facilitator handler accepted settlement and returned: {*}",
        t,
      );

      logger.info(
        `${t.success ? "succeeded" : "failed"} settlement request: {*}`,
        {
          requirements: summarizeRequirements(x402Req.paymentRequirements),
          txHash: t.txHash,
        },
      );

      return c.json(t);
    }
    sendSettleError(c, 400, "no matching payment handler found");
    logger.warning(
      "attempt to settle was made with no handler found, requirements summary was: {*}",
      summarizeRequirements(x402Req.paymentRequirements),
    );
  });

  router.post("/accepts", async (c) => {
    const x402Req = x.x402PaymentRequiredResponse(await c.req.json());

    if (isValidationError(x402Req)) {
      return sendSettleError(
        c,
        400,
        `couldn't parse required response: ${x402Req.summary}`,
      );
    }

    const results = await allSettledWithTimeout(
      args.handlers.flatMap((x) => x.getRequirements(x402Req.accepts)),
      args.timeout?.getRequirements ?? 500,
    );

    const accepts = results
      .filter((x) => x.status === "fulfilled")
      .map((x) => x.value)
      .flat();

    results.forEach((x) => {
      if (x.status === "rejected") {
        let message: string;

        if (x.reason instanceof Error) {
          message = x.reason.message;
        } else {
          message = "unknown reason";
        }

        logger.error(
          `failed to retrieve requirements from facilitator handler: ${message}`,
          x.reason,
        );
      }
    });

    logger.debug(`returning ${accepts.length} accepts: {*}`, {
      accepts: accepts.map(summarizeRequirements),
    });

    c.status(200);
    return c.json({
      x402Version: 1,
      accepts,
    });
  });

  router.get("/supported", async (c) => {
    const results = await allSettledWithTimeout(
      args.handlers.flatMap((x) => (x.getSupported ? x.getSupported() : [])),
      args.timeout?.getSupported ?? 500,
    );

    const kinds = results
      .filter((x) => x.status === "fulfilled")
      .map((x) => x.value)
      .flat();

    results.forEach((x) => {
      if (x.status === "rejected") {
        let message: string;

        if (x.reason instanceof Error) {
          message = x.reason.message;
        } else {
          message = "unknown reason";
        }

        logger.error(
          `failed to retrieve supported from facilitator handler: ${message}`,
          x.reason,
        );
      }
    });

    logger.debug(`returning ${kinds.length} kinds supported: {*}`, {
      kinds,
    });

    c.status(200);
    return c.json({
      kinds,
    });
  });

  return router;
}
