import {
  handleMiddlewareRequest,
  type CommonMiddlewareArgs,
  createPaymentRequiredResponseCache,
} from "./common";
import type { MiddlewareHandler } from "hono";

type CreateMiddlewareArgs = {
  verifyBeforeSettle?: boolean;
} & CommonMiddlewareArgs;

export async function createMiddleware(
  args: CreateMiddlewareArgs,
): Promise<MiddlewareHandler> {
  const { getPaymentRequiredResponse } = createPaymentRequiredResponseCache(
    args.cacheConfig,
  );

  return async (c, next) => {
    return await handleMiddlewareRequest({
      ...args,
      resource: c.req.url,
      getHeader: (key) => c.req.header(key),
      getPaymentRequiredResponse,
      sendJSONResponse: (status, body, headers) => {
        c.status(status);
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            c.header(key, value);
          }
        }
        if (body) {
          return c.json(body);
        }
        return c.body(null);
      },
      body: async ({ verify, settle }) => {
        if (args.verifyBeforeSettle) {
          // If configured, try to verify the transaction before running
          // the next operation.
          const verifyResult = await verify();
          if (!verifyResult.success) {
            return verifyResult.errorResponse;
          }
        } else {
          // Otherwise just settle the payment beforehand, like we've
          // done historically.
          const settleResult = await settle();
          if (!settleResult.success) {
            return settleResult.errorResponse;
          }
        }

        await next();

        if (args.verifyBeforeSettle) {
          // Close out the verification, by actually settling the
          // payment.
          const settleResult = await settle();
          if (!settleResult.success) {
            // If the settlement fails, we need to explicitly
            // overwrite the downstream result.  See:
            //
            // https://hono.dev/docs/guides/middleware#modify-the-response-after-next
            //

            c.res = undefined;
            c.res = settleResult.errorResponse;
          }
        }
      },
    });
  };
}
