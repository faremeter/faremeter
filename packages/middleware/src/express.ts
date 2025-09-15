import { handleMiddlewareRequest, type CommonMiddlewareArgs } from "./common";
import type { NextFunction, Request, Response } from "express";

type createMiddlewareArgs = CommonMiddlewareArgs;

export async function createMiddleware(args: createMiddlewareArgs) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const response = await handleMiddlewareRequest({
      ...args,
      resource: `${req.protocol}://${req.headers.host}${req.path}`,
      getHeader: (key) => req.header(key),
      sendJSONResponse: (status, body) => res.status(status).json(body),
    });

    if (response) {
      return;
    }

    next();
  };
}
