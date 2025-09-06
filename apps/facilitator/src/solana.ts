import { createFacilitatorHandler as createSolanaHandler } from "@faremeter/x-solana-settlement/facilitator";
import {
  createFacilitatorHandler as createFacilitatorHandlerExact,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/kit";
import fs from "fs";
import type { FacilitatorHandler } from "@faremeter/types";

const USDC_MINT_ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // USDC devnet

const { ADMIN_KEYPAIR_PATH, ASSET_ADDRESS } = process.env;

export function createHandlers() {
  const handlers: FacilitatorHandler[] = [];
  // Solana configuration
  if (!(ADMIN_KEYPAIR_PATH && ASSET_ADDRESS)) {
    return handlers;
  }
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))),
  );
  const network = "devnet";
  const apiUrl = clusterApiUrl(network);
  const connection = new Connection(apiUrl, "confirmed");
  const rpc = createSolanaRpc(apiUrl);
  const mint = new PublicKey(ASSET_ADDRESS);
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

  console.log("Solana handlers configured for devnet");
  return handlers;
}
