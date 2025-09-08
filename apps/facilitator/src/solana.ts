import { logger } from "./logger";
import { createFacilitatorHandler } from "@faremeter/x-solana-settlement/facilitator";
import {
  createFacilitatorHandler as createFacilitatorHandlerExact,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  type Cluster,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createSolanaRpc } from "@solana/kit";
import fs from "fs";
import type { FacilitatorHandler } from "@faremeter/types";

const USDC_MINT_ADDRESSES: Record<Cluster, string> = {
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  testnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

const EXACT_NETWORK_MAP: Record<Cluster, string> = {
  devnet: "devnet",
  "mainnet-beta": "mainnet",
  testnet: "testnet",
};

function isNetworkValid(c: string): c is Cluster {
  return c in USDC_MINT_ADDRESSES;
}

async function isValidSplToken(
  connection: Connection,
  mintAddress: PublicKey,
): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(mintAddress);
    return accountInfo?.owner.equals(TOKEN_PROGRAM_ID) ?? false;
  } catch {
    return false;
  }
}

export async function createHandlers(
  network: string,
  keypairPath: string,
  assetAddress: string,
  assetNetwork?: string,
) {
  if (!isNetworkValid(network)) {
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
  const usdcMint = new PublicKey(USDC_MINT_ADDRESSES[network]);
  const exactNetworkName = EXACT_NETWORK_MAP[network];

  // x-solana-settlement handlers (devnet only)
  if (network === "devnet") {
    handlers.push(
      // SOL
      createFacilitatorHandler(network, connection, adminKeypair),
      // USDC SPL Token
      createFacilitatorHandler(network, connection, adminKeypair, usdcMint),
    );
  }

  // exact scheme handlers (all networks)
  handlers.push(
    // USDC with exact scheme
    createFacilitatorHandlerExact(
      lookupX402Network(exactNetworkName),
      rpc,
      adminKeypair,
      usdcMint,
    ),
  );

  // Add custom asset only if this network matches ASSET_NETWORK
  if (assetNetwork === network) {
    const mint = new PublicKey(assetAddress);
    if (!mint.equals(usdcMint)) {
      if (await isValidSplToken(connection, mint)) {
        handlers.push(
          // Custom SPL Token with exact scheme
          createFacilitatorHandlerExact(
            lookupX402Network(exactNetworkName),
            rpc,
            adminKeypair,
            mint,
          ),
        );
        logger.info(`  - Custom asset ${assetAddress} on ${network}`);
      }
    }
  }

  logger.info(`Solana handlers configured for ${network}`);
  return handlers;
}
