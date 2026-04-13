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
  /**
   * Called once per successful `/response` with the capture envelope
   * that will be returned to the Lua gateway. The hook fires for
   * every matched capture. One-phase (capture-only) rules report
   * `result.settled === true` when a non-zero amount was charged at
   * request time; zero-amount captures and unmatched rules report
   * `result.settled === false`. Consumers that only care about
   * settled bills should gate on `result.settled`.
   *
   * The hook runs post-settlement and is awaited to catch async
   * rejections. A throw or rejected promise is logged but must not
   * corrupt the authoritative response: the capture envelope is
   * returned to the gateway regardless of hook outcome.
   */
  onCapture?: (
    operationKey: string,
    result: CaptureResponse,
  ) => void | Promise<void>;
};

// The Lua gateway has two mutually incompatible contracts for the
// sidecar's two endpoints:
//
//   `/request` — access-phase. The Lua in `access.lua` bails with
//     `bad_gateway` on any non-200 HTTP response. Error paths must
//     therefore return transport status 200 with a JSON envelope
//     whose `status` field carries the semantic HTTP status for the
//     end client (400 on validation failure, 500 on handler error).
//
//   `/response` — log-phase. The Lua in `shared.lua` `flush_capture`
//     deletes the buffered capture on any 2xx and retries on any
//     non-2xx. Error paths must therefore return transport status
//     >=300 so the buffer is preserved for the retry attempts. A
//     2xx return on an error path would silently delete the bill.
//
// A single catch-all error handler cannot satisfy both contracts, so
// each route has its own per-route try/catch and `app.onError` uses
// the request path to pick the right shape for anything that slips
// through synchronously.

type GatewayEnvelope = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

function errorEnvelope(status: number, error: string): GatewayEnvelope {
  return { status, body: { error } };
}

type ParseJSONResult =
  | { ok: true; value: unknown }
  | { ok: false; error: Error };

async function parseJSON(request: Request): Promise<ParseJSONResult> {
  try {
    return { ok: true, value: await request.json() };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
}

export function createApp(config: CreateAppOpts) {
  const { onCapture, ...handlerConfig } = config;
  const handler = createGatewayHandler(handlerConfig);
  const app = new Hono();

  app.post("/request", async (c) => {
    const parsed = await parseJSON(c.req.raw);
    if (!parsed.ok) {
      logger.debug("malformed JSON body", { endpoint: "/request" });
      return c.json(errorEnvelope(400, "malformed JSON body"));
    }
    const validated = requestContext(parsed.value);
    if (isValidationError(validated)) {
      return c.json(errorEnvelope(400, validated.summary));
    }
    logger.debug("gateway /request", {
      operationKey: validated.operationKey,
    });
    try {
      return c.json(await handler.handleRequest(validated));
    } catch (cause) {
      logger.error("handleRequest threw", {
        operationKey: validated.operationKey,
        message: cause instanceof Error ? cause.message : String(cause),
        stack: cause instanceof Error ? cause.stack : undefined,
      });
      return c.json(errorEnvelope(500, "internal error"));
    }
  });

  app.post("/response", async (c) => {
    // `flush_capture` in `shared.lua` deletes the buffered capture on
    // any 2xx response from `/response` and retries on any non-2xx.
    // Every error path on this route must therefore return transport
    // status >=300 so the buffer is preserved; returning 200+envelope
    // (as `/request` does) would silently delete the bill.
    const parsed = await parseJSON(c.req.raw);
    if (!parsed.ok) {
      logger.debug("malformed JSON body", { endpoint: "/response" });
      return c.json({ error: "malformed JSON body" }, 500);
    }
    const validated = responseContext(parsed.value);
    if (isValidationError(validated)) {
      logger.error("/response validation failure", {
        summary: validated.summary,
      });
      return c.json({ error: validated.summary }, 500);
    }
    logger.debug("gateway /response", {
      operationKey: validated.operationKey,
    });
    let result: CaptureResponse;
    try {
      result = await handler.handleResponse(validated);
    } catch (cause) {
      logger.error("handleResponse threw", {
        operationKey: validated.operationKey,
        message: cause instanceof Error ? cause.message : String(cause),
        stack: cause instanceof Error ? cause.stack : undefined,
      });
      // Return 422 (not 500) so Lua's `flush_capture` retries
      // without triggering sidecar-down alerts. The sidecar is
      // healthy — the capture expression failed to evaluate against
      // the response body (missing field, negative coefficient,
      // etc.). 422 signals "your data was unprocessable" rather
      // than "the service crashed."
      return c.json(
        { error: cause instanceof Error ? cause.message : "capture failed" },
        422,
      );
    }
    if (onCapture) {
      // The hook runs post-settlement. A throw or async rejection must
      // not corrupt the nginx contract by flipping a settled response
      // to 5xx — log it and return the authoritative result anyway.
      // Awaiting the hook (even when the signature is `=> void`) is the
      // only way to catch async rejections, which would otherwise become
      // process-level unhandled rejections.
      try {
        await onCapture(validated.operationKey, result);
      } catch (cause) {
        logger.error("onCapture hook threw", {
          operationKey: validated.operationKey,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    return c.json(result);
  });

  app.onError((err, c) => {
    const path = c.req.path;
    logger.error("unhandled sidecar error", {
      path,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Per-route contract dispatch (see the block comment at the top
    // of this file). A single catch-all cannot satisfy both routes:
    //
    //   `/request` expects transport 200 + envelope — `access.lua`
    //   treats any non-200 as `bad_gateway`.
    //
    //   `/response` expects transport >=300 on errors —
    //   `flush_capture` in `shared.lua` deletes the buffered capture
    //   on any 2xx, so returning 200 here on a surprise synchronous
    //   throw would silently lose the bill.
    //
    // Any unknown route (health checks, typos) falls through to the
    // `/request`-style envelope shape, which is harmless because
    // nothing on that path consumes the response.
    if (path === "/response") {
      return c.json(
        { error: err instanceof Error ? err.message : "internal error" },
        422,
      );
    }
    return c.json(errorEnvelope(500, "internal error"));
  });

  return { app };
}

export type MultiSiteConfig = Record<string, CreateAppOpts>;

export function createMultiSiteApp(sites: MultiSiteConfig) {
  const app = new Hono();

  for (const [name, config] of Object.entries(sites)) {
    const site = createApp(config);
    app.route(`/sites/${name}`, site.app);
  }

  app.onError((err, c) => {
    const path = c.req.path;
    logger.error("unhandled sidecar error", {
      path,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (path.endsWith("/response")) {
      return c.json(
        { error: err instanceof Error ? err.message : "internal error" },
        422,
      );
    }
    return c.json(errorEnvelope(500, "internal error"));
  });

  return { app };
}
