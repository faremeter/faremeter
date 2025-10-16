import {
  handleMiddlewareRequest,
  type CommonMiddlewareArgs,
  createPaymentRequiredResponseCache,
} from "./common";
import type { MiddlewareHandler } from "hono";

type CreateMiddlewareArgs = CommonMiddlewareArgs;

export async function createMiddleware(
  args: CreateMiddlewareArgs,
): Promise<MiddlewareHandler> {
  const { getPaymentRequiredResponse } = createPaymentRequiredResponseCache(
    args.cacheConfig,
  );

  return async (c, next) => {
    const response = await handleMiddlewareRequest({
      ...args,
      resource: c.req.url,
      getHeader: (key) => c.req.header(key),
      getPaymentRequiredResponse,
      sendJSONResponse: (status, body) => {
        c.status(status);
        return c.json(body);
      },
    });

    if (response) {
      return response;
    }

    await next();
  };
}
