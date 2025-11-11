import "dotenv/config";
import { logger } from "./logger";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { serve } from "@hono/node-server";
import { createFacilitatorRoutes } from "@faremeter/facilitator";

import { argsFromEnv } from "./utils";
import * as solana from "./solana";
import { createFacilitatorHandler as createEVMHandler } from "@faremeter/payment-evm/exact";
import * as evmChains from "viem/chains";

import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
    { category: "faremeter", lowestLevel: "info", sinks: ["console"] },
  ],
});

const solanaHandlers =
  (await argsFromEnv(["ADMIN_KEYPAIR_PATH"], async (...envVars) =>
    solana.createHandlers("mainnet-beta", ...envVars),
  )) ?? [];

const handlers = [...solanaHandlers];

if (handlers.length === 0) {
  logger.error(
    "ERROR: No payment handlers configured.\n" +
      "   Set ADMIN_KEYPAIR_PATH for Solana\n" +
      "   Set EVM_PRIVATE_KEY for EVM",
  );
  process.exit(1);
}

const listenPort = process.env.PORT ? parseInt(process.env.PORT) : 4000;

const app = new Hono();
app.use(
  honoLogger((message: string, ...rest: string[]) => {
    logger.info([message, ...rest].join(" "));
  }),
);

app.route(
  "/",
  createFacilitatorRoutes({
    handlers,
    timeout: {
      getRequirements: 5000,
    },
  }),
);

serve({ fetch: app.fetch, port: listenPort }, (info) => {
  logger.info(`Facilitator server listening on port ${info.port}`);
  logger.info(`Active payment handlers: ${handlers.length}`);
  if (solanaHandlers.length > 0) {
    logger.info("   - Solana (SOL & SPL Token)");
  }
});
