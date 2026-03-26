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
 * Creates Express middleware that gates routes behind x402 payment.
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
      pricing: resolved.pricing,
      supportedVersions,
      resource,
      getHeader: (key) => req.header(key),
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
      body: async ({ settle }) => {
        const settleResult = await settle();
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
