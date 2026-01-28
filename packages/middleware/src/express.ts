import {
  handleMiddlewareRequest,
  type CommonMiddlewareArgs,
  createPaymentRequiredResponseCache,
} from "./common";
import type { NextFunction, Request, Response } from "express";

type createMiddlewareArgs = CommonMiddlewareArgs;

export async function createMiddleware(args: createMiddlewareArgs) {
  const { getPaymentRequiredResponse } = createPaymentRequiredResponseCache(
    args.cacheConfig,
  );

  return async (req: Request, res: Response, next: NextFunction) => {
    return await handleMiddlewareRequest({
      ...args,
      resource: `${req.protocol}://${req.headers.host}${req.path}`,
      getPaymentRequiredResponse,
      getHeader: (key) => req.header(key),
      sendJSONResponse: (status, body, headers) => {
        res.status(status);
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            res.setHeader(key, value);
          }
        }
        if (body) {
          return res.json(body);
        }
        return res.end();
      },
      body: async ({ settle }) => {
        const settleResult = await settle();
        if (!settleResult.success) {
          return settleResult.errorResponse;
        }

        next();
      },
    });
  };
}
