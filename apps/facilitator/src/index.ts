import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createFacilitatorRoutes } from "@faremeter/facilitator";

import * as solana from "./solana";
import * as evm from "./evm";

const solanaHandlers = solana.createHandlers();
const evmHandlers = evm.createHandlers();

const handlers = [...solanaHandlers, ...evmHandlers];

if (handlers.length === 0) {
  console.error(
    "ERROR: No payment handlers configured.\n" +
      "   Set ADMIN_KEYPAIR_PATH and ASSET_ADDRESS for Solana\n" +
      "   Set EVM_RECEIVING_ADDRESS and EVM_PRIVATE_KEY for EVM",
  );
  process.exit(1);
}

const listenPort = process.env.PORT ? parseInt(process.env.PORT) : 4000;

const app = new Hono();
app.route(
  "/",
  createFacilitatorRoutes({
    handlers,
  }),
);

serve({ fetch: app.fetch, port: listenPort }, (info) => {
  console.log(`Facilitator server listening on port ${info.port}`);
  console.log(`Active payment handlers: ${handlers.length}`);
  if (solanaHandlers.length > 0) {
    console.log("   - Solana (SOL & SPL Token)");
  }
  if (evmHandlers.length > 0) {
    console.log("   - EVM (Base Sepolia)");
  }
});
