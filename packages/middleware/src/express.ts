import {
  handleMiddlewareRequest,
  type CommonMiddlewareArgs,
  getPaymentRequiredResponse,
} from "./common";
import type { NextFunction, Request, Response } from "express";

type createMiddlewareArgs = CommonMiddlewareArgs;

export async function createMiddleware(args: createMiddlewareArgs) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const response = await handleMiddlewareRequest({
      ...args,
      resource: `${req.protocol}://${req.headers.host}${req.path}`,
      getPaymentRequiredResponse,
      getHeader: (key) => req.header(key),
      sendJSONResponse: (status, body) => res.status(status).json(body),
    });

    if (response) {
      return;
    }

    next();
  };
}
