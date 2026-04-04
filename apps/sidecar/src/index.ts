import { serve } from "@hono/node-server";
import { configureApp } from "@faremeter/logs";
import { loadSpec } from "@faremeter/middleware-openapi";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

await configureApp();

const DEFAULT_PORT = 4002;

async function main() {
  const specPath = process.argv[2] ?? process.env.FAREMETER_SPEC;
  if (!specPath) {
    logger.fatal("usage: sidecar <spec-path>");
    process.exit(1);
  }

  const spec = await loadSpec(specPath);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const { app } = createApp({ spec });

  logger.info("starting sidecar", { port, specPath });
  serve({ fetch: app.fetch, port });
}

main().catch((err: unknown) => {
  logger.fatal("failed to start sidecar", { error: String(err) });
  process.exit(1);
});
