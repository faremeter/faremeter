import { Hono } from "hono";
import { isValidationError } from "@faremeter/types";
import {
  createGatewayHandler,
  requestContext,
  responseContext,
  type CaptureResponse,
  type GatewayHandlerConfig,
} from "@faremeter/middleware-openapi";
import { logger } from "./logger.js";

export type CreateAppOpts = GatewayHandlerConfig & {
  onCapture?: (operationKey: string, result: CaptureResponse) => void;
};

export function createApp(config: CreateAppOpts) {
  const { onCapture, ...handlerConfig } = config;
  const handler = createGatewayHandler(handlerConfig);
  const app = new Hono();

  app.post("/request", async (c) => {
    const validated = requestContext(await c.req.json());
    if (!isValidationError(validated)) {
      logger.debug("gateway /request", {
        operationKey: validated.operationKey,
      });
      return c.json(await handler.handleRequest(validated));
    }
    return c.json({ error: validated.summary }, 400);
  });

  app.post("/response", async (c) => {
    const validated = responseContext(await c.req.json());
    if (!isValidationError(validated)) {
      logger.debug("gateway /response", {
        operationKey: validated.operationKey,
      });
      const result = await handler.handleResponse(validated);
      onCapture?.(validated.operationKey, result);
      return c.json(result);
    }
    return c.json({ error: validated.summary }, 400);
  });

  return { app };
}
