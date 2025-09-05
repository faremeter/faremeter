import { Hono, type Context } from "hono";
import * as x from "@faremeter/types/x402";
import { isValidationError, type FacilitatorHandler } from "@faremeter/types";

type CreateFacilitatorRoutesArgs = {
  handlers: FacilitatorHandler[];
};

export function createFacilitatorRoutes(args: CreateFacilitatorRoutesArgs) {
  const router = new Hono();

  function sendError(c: Context, msg: string) {
    return c.json({
      isValid: false,
      invalidReason: msg,
    });
  }

  router.post("/settle", async (c) => {
    const x402Req = x.x402SettleRequest(await c.req.json());

    if (isValidationError(x402Req)) {
      return sendError(c, `couldn't validate request: ${x402Req.summary}`);
    }

    const paymentPayload = x.x402PaymentHeaderToPayload(x402Req.paymentHeader);

    if (isValidationError(paymentPayload)) {
      return sendError(
        c,
        `couldn't validate x402 payload: ${paymentPayload.summary}`,
      );
    }

    for (const handler of args.handlers) {
      const t = await handler.handleSettle(
        x402Req.paymentRequirements,
        paymentPayload,
      );

      if (t === null) {
        continue;
      }

      return c.json(t);
    }
    sendError(c, "no matching payment handler found");
  });

  router.post("/accepts", async (c) => {
    const x402Req = x.x402PaymentRequiredResponse(await c.req.json());

    if (isValidationError(x402Req)) {
      return sendError(
        c,
        `couldn't parse required response: ${x402Req.summary}`,
      );
    }

    const accepts: x.x402PaymentRequirements[] = (
      await Promise.all(
        args.handlers.flatMap((x) => x.getRequirements(x402Req.accepts)),
      )
    ).flat();

    // XXX - This is not exactly standard.
    c.status(402);
    return c.json({
      x402Version: 1,
      accepts,
    });
  });

  return router;
}
