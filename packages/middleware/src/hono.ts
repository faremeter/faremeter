import {
  handleMiddlewareRequest,
  type CommonMiddlewareArgs,
  type HandleMiddlewareRequestArgs,
  validateMiddlewareArgs,
  resolveSupportedVersions,
  resolveConfig,
} from "./common";
import type { MiddlewareHandler } from "hono";

/**
 * Configuration arguments for creating Hono payment middleware.
 */
type CreateMiddlewareArgs = {
  /** If true, verifies payment before running the handler, then settles after. */
  verifyBeforeSettle?: boolean;
} & CommonMiddlewareArgs;

/**
 * Creates Hono middleware that gates routes behind x402 and MPP payment.
 *
 * The middleware intercepts requests, checks for payment headers, validates
 * and settles payments via x402 or MPP protocol, and only allows the
 * request to proceed if payment is successful.
 *
 * @param args - Configuration including handlers + pricing or facilitator URL
 * @returns A Hono middleware handler
 */
export async function createMiddleware(
  args: CreateMiddlewareArgs,
): Promise<MiddlewareHandler> {
  validateMiddlewareArgs(args);
  const supportedVersions = resolveSupportedVersions(args.supportedVersions);
  const resolved = resolveConfig(args);

  return async (c, next) => {
    const reqArgs: HandleMiddlewareRequestArgs<Response> = {
      x402Handlers: resolved.handlers,
      mppMethodHandlers: resolved.mppHandlers,
      pricing: resolved.pricing,
      supportedVersions,
      resource: c.req.url,
      getHeader: (key) => c.req.header(key),
      setResponseHeader: (key, value) => c.header(key, value),
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
      body: async (context) => {
        if (context.protocolVersion === "mpp") {
          const settleResult = await context.settle();
          if (!settleResult.success) {
            return settleResult.errorResponse;
          }
          await next();
          return;
        }

        const { verify, settle } = context;
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
    };

    if (resolved.resourceInfo) {
      reqArgs.resourceInfo = { ...resolved.resourceInfo, url: c.req.url };
    }

    return await handleMiddlewareRequest(reqArgs);
  };
}
