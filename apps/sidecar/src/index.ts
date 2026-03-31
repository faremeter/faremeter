import { serve } from "@hono/node-server";
import { configureApp } from "@faremeter/logs";
import { loadSpec } from "@faremeter/middleware-openapi";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

await configureApp();

const DEFAULT_PORT = 4002;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    logger.fatal(`PORT must be an integer 1-65535, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

async function main() {
  const specPath = process.argv[2] ?? process.env.FAREMETER_SPEC;
  if (!specPath) {
    logger.fatal("usage: sidecar <spec-path> (or set FAREMETER_SPEC)");
    process.exit(1);
  }

  const baseURL = process.env.FAREMETER_BASE_URL;
  if (!baseURL) {
    logger.fatal(
      "FAREMETER_BASE_URL is required; it is the public URL of the " +
        "gateway in front of the upstream service and is used verbatim as " +
        "the x402 'resource' field",
    );
    process.exit(1);
  }

  const spec = await loadSpec(specPath);
  const port = parsePort(process.env.PORT);
  const { app } = createApp({ spec, baseURL });

  logger.info("starting sidecar", { port, specPath, baseURL });
  serve({ fetch: app.fetch, port });
}

main().catch((cause: unknown) => {
  logger.fatal("failed to start sidecar", {
    message: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
  });
  process.exit(1);
});
