import { default as express } from "express";
import * as x from "@faremeter/types/x402";
import { isValidationError, type FacilitatorHandler } from "@faremeter/types";

type CreateFacilitatorRoutesArgs = {
  handlers: FacilitatorHandler[];
};

export function createFacilitatorRouter(
  args: CreateFacilitatorRoutesArgs,
): express.Router {
  const router = express.Router();
  router.use(express.json());

  function sendError(res: express.Response, msg: string) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        isValid: false,
        invalidReason: msg,
      }),
    );
  }

  function sendResponse(res: express.Response, obj: object) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  }

  router.post("/settle", async (req, res) => {
    const x402Req = x.x402SettleRequest(req.body);

    if (isValidationError(x402Req)) {
      return sendError(res, `couldn't validate request: ${x402Req.summary}`);
    }

    const paymentPayload = x.x402PaymentHeaderToPayload(x402Req.paymentHeader);

    if (isValidationError(paymentPayload)) {
      return sendError(
        res,
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

      return sendResponse(res, t);
    }
    sendError(res, "no matching payment handler found");
  });

  router.post("/accepts", async (req, res) => {
    const x402Req = x.x402PaymentRequiredResponse(req.body);

    if (isValidationError(x402Req)) {
      return sendError(
        res,
        `couldn't parse required response: ${x402Req.summary}`,
      );
    }

    const accepts: x.x402PaymentRequirements[] = (
      await Promise.all(
        args.handlers.flatMap((x) => x.getRequirements(x402Req.accepts)),
      )
    ).flat();

    // XXX - This is not exactly standard.
    res.status(402).json({
      x402Version: 1,
      accepts,
    });
  });

  return router;
}
