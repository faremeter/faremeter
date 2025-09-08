import { logger } from "./logger";

import { createFacilitatorHandler as createSolanaHandler } from "@faremeter/x-solana-settlement/facilitator";
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

const USDC_MINT_ADDRESSES: Record<string, string> = {
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

const EXACT_NETWORK_MAP: Record<string, string> = {
  devnet: "devnet",
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
    return accountInfo !== null && accountInfo.owner.equals(TOKEN_PROGRAM_ID);
  } catch {
    return false;
  }
}

export async function createHandlers(
  network: string,
  keypairPath: string,
  assetAddress: string,
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
  const mint = new PublicKey(assetAddress);

  const usdcAddress = USDC_MINT_ADDRESSES[network];
  const exactNetworkName = EXACT_NETWORK_MAP[network];

  if (!usdcAddress || !exactNetworkName) {
    logger.error(`Configuration missing for network '${network}'`);
    process.exit(1);
  }

  const usdcMint = new PublicKey(usdcAddress);

  // Validate that the custom asset exists on this network
  if (!mint.equals(usdcMint) && !(await isValidSplToken(connection, mint))) {
    logger.error(
      `Asset ${assetAddress} is not a valid SPL token on ${network}`,
    );
    process.exit(1);
  }

  // Add Solana handlers
  handlers.push(
    // SOL
    createSolanaHandler(network, connection, adminKeypair),
    // SPL Token
    createSolanaHandler(network, connection, adminKeypair, mint),
    // SPL Token with exact scheme
    createFacilitatorHandlerExact(
      lookupX402Network(exactNetworkName),
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
        lookupX402Network(exactNetworkName),
        rpc,
        adminKeypair,
        usdcMint,
      ),
    );
  }

  logger.info(`Solana handlers configured for ${network}`);
  return handlers;
}
