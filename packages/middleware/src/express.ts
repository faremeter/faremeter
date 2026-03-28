import {
  handleMiddlewareRequest,
  type CommonMiddlewareArgs,
  type HandleMiddlewareRequestArgs,
  validateMiddlewareArgs,
  resolveSupportedVersions,
  resolveConfig,
} from "./common";
import type { NextFunction, Request, Response } from "express";

type createMiddlewareArgs = CommonMiddlewareArgs;

/**
 * Creates Express middleware that gates routes behind x402 and MPP payment.
 *
 * @param args - Configuration including handlers + pricing or facilitator URL
 * @returns An Express middleware function
 */
export async function createMiddleware(args: createMiddlewareArgs) {
  validateMiddlewareArgs(args);
  const supportedVersions = resolveSupportedVersions(args.supportedVersions);
  const resolved = resolveConfig(args);

  return async (req: Request, res: Response, next: NextFunction) => {
    const resource = `${req.protocol}://${req.headers.host}${req.path}`;

    const reqArgs: HandleMiddlewareRequestArgs = {
      x402Handlers: resolved.handlers,
      mppMethodHandlers: resolved.mppHandlers,
      pricing: resolved.pricing,
      supportedVersions,
      resource,
      getHeader: (key) => req.header(key),
      // XXX - Body digest requires raw request bytes. When Express uses
      // body-parser, req.body is a parsed object and re-serialization
      // will not match the original bytes. Use express.raw() middleware
      // for endpoints that need digest binding.
      getBody: async () => {
        if (!req.body) return null;
        if (Buffer.isBuffer(req.body)) return new Uint8Array(req.body).buffer;
        if (typeof req.body === "string")
          return new TextEncoder().encode(req.body).buffer;
        return null;
      },
      setResponseHeader: (key, value) => res.setHeader(key, value),
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
      body: async (context) => {
        const settleResult = await context.settle();
        if (!settleResult.success) {
          return settleResult.errorResponse;
        }

        next();
      },
    };

    if (resolved.resourceInfo) {
      reqArgs.resourceInfo = { ...resolved.resourceInfo, url: resource };
    }

    return await handleMiddlewareRequest(reqArgs);
  };
}
