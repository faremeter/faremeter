import { logger } from "./logger";

import { createFacilitatorHandler as createSolanaHandler } from "@faremeter/x-solana-settlement/facilitator";
import {
  createFacilitatorHandler as createFacilitatorHandlerExact,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/kit";
import { isKnownCluster } from "@faremeter/info/solana";
import fs from "fs";
import type { FacilitatorHandler } from "@faremeter/types";

const USDC_MINT_ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // USDC devnet

export function createHandlers(
  network: string,
  keypairPath: string,
  assetAddress: string,
) {
  if (!isKnownCluster(network)) {
    logger.error(`Solana network '${network}' is invalid`);
    process.exit(1);
  }

  const handlers: FacilitatorHandler[] = [];
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8"))),
  );
  const apiUrl = clusterApiUrl(network);
  const connection = new Connection(apiUrl, "confirmed");
  const rpc = createSolanaRpc(apiUrl);
  const mint = new PublicKey(assetAddress);
  const usdcMint = new PublicKey(USDC_MINT_ADDRESS);

  // Add Solana handlers
  handlers.push(
    // SOL
    createSolanaHandler(network, connection, adminKeypair),
    // SPL Token
    createSolanaHandler(network, connection, adminKeypair, mint),
    // SPL Token with exact scheme
    createFacilitatorHandlerExact(
      lookupX402Network(network),
      rpc,
      adminKeypair,
      mint,
    ),
  );

  if (!mint.equals(usdcMint)) {
    handlers.push(
      // USDC SPL Token
      createSolanaHandler(network, connection, adminKeypair, usdcMint),
      // USDC with exact scheme
      createFacilitatorHandlerExact(
        lookupX402Network(network),
        rpc,
        adminKeypair,
        usdcMint,
      ),
    );
  }

  logger.info(`Solana handlers configured for ${network}`);
  return handlers;
}
