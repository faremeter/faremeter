import "dotenv/config";
import { default as express } from "express";
import { createFacilitatorHandler } from "@faremeter/x-solana-settlement/facilitator";
import {
  createFacilitatorHandler as createFacilitatorHandlerExact,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/kit";
import { createFacilitatorRouter } from "./routes";
import fs from "fs";
import type { FacilitatorHandler } from "@faremeter/types";

const { ADMIN_KEYPAIR_PATH, ASSET_ADDRESS } = process.env;

const handlers: FacilitatorHandler[] = [];

// Solana configuration
if (ADMIN_KEYPAIR_PATH && ASSET_ADDRESS) {
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))),
  );
  const network = "devnet";
  const apiUrl = clusterApiUrl(network);
  const connection = new Connection(apiUrl, "confirmed");
  const rpc = createSolanaRpc(apiUrl);
  const mint = new PublicKey(ASSET_ADDRESS);

  // Add Solana handlers
  handlers.push(
    // SOL
    createFacilitatorHandler(network, connection, adminKeypair),
    // SPL Token
    createFacilitatorHandler(network, connection, adminKeypair, mint),
    // SPL Token with exact scheme
    createFacilitatorHandlerExact(
      lookupX402Network(network),
      rpc,
      adminKeypair,
      mint,
    ),
  );
  console.log("Solana handlers configured for devnet");
}

if (handlers.length === 0) {
  console.error(
    "ERROR: No payment handlers configured.\n" +
      "   Set ADMIN_KEYPAIR_PATH and ASSET_ADDRESS for Solana",
  );
  process.exit(1);
}

const listenPort = process.env.PORT ? parseInt(process.env.PORT) : 4000;

const app = express();
app.use(
  "/",
  createFacilitatorRouter({
    handlers,
  }),
);

app.listen(listenPort, () => {
  console.log(`Facilitator server listening on port ${listenPort}`);
  console.log(`Active payment handlers: ${handlers.length}`);
  if (ADMIN_KEYPAIR_PATH && ASSET_ADDRESS) {
    console.log("   - Solana (SOL & SPL Token)");
  }
});
