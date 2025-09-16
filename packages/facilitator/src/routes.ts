import { getLogger } from "@logtape/logtape";
import { Hono, type Context } from "hono";
import * as x from "@faremeter/types/x402";
import { isValidationError, type FacilitatorHandler } from "@faremeter/types";

const logger = getLogger(["faremeter", "facilitator"]);

type CreateFacilitatorRoutesArgs = {
  handlers: FacilitatorHandler[];
};

type StatusCode = 400 | 500;

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

      return c.json(t);
    }
    sendSettleError(c, 400, "no matching payment handler found");
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

    const accepts: x.x402PaymentRequirements[] = (
      await Promise.all(
        args.handlers.flatMap((x) => x.getRequirements(x402Req.accepts)),
      )
    ).flat();

    c.status(200);
    return c.json({
      x402Version: 1,
      accepts,
    });
  });

  return router;
}
