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
  /**
   * If true, authorize the payment before running the handler and
   * capture it after. Otherwise capture once up-front.
   */
  authorizeBeforeCapture?: boolean;
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
      getBody: async () => {
        if (c.req.method === "GET" || c.req.method === "HEAD") return null;
        try {
          return await c.req.raw.clone().arrayBuffer();
        } catch {
          return null;
        }
      },
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
          const captureResult = await context.capture();
          if (!captureResult.success) {
            return captureResult.errorResponse;
          }
          await next();
          return;
        }

        const { authorize, capture } = context;
        if (args.authorizeBeforeCapture) {
          // If configured, authorize the payment before running
          // the next operation.
          const authorizeResult = await authorize();
          if (!authorizeResult.success) {
            return authorizeResult.errorResponse;
          }
        } else {
          // Otherwise just capture the payment beforehand, like we've
          // done historically.
          const captureResult = await capture();
          if (!captureResult.success) {
            return captureResult.errorResponse;
          }
        }

        await next();

        if (args.authorizeBeforeCapture) {
          // Close out the authorization by actually capturing the
          // payment.
          const captureResult = await capture();
          if (!captureResult.success) {
            // If the capture fails, we need to explicitly
            // overwrite the downstream result.  See:
            //
            // https://hono.dev/docs/guides/middleware#modify-the-response-after-next
            //

            c.res = undefined;
            c.res = captureResult.errorResponse;
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
