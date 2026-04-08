import { logger } from "./logger";

import { createFacilitatorHandler as createFacilitatorHandlerExact } from "@faremeter/payment-solana/exact";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
} from "@solana/kit";
import { isKnownCluster, lookupKnownSPLToken } from "@faremeter/info/solana";
import fs from "fs";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";

const clusterRpcUrls: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

export async function createHandlers(network: string, keypairPath: string) {
  if (!isKnownCluster(network)) {
    logger.error(`Solana network '${network}' is invalid`);
    process.exit(1);
  }

  const handlers: FacilitatorHandler[] = [];
  const secretKey = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf-8")),
  );
  const adminSigner = await createKeyPairSignerFromBytes(secretKey);
  const apiUrl = clusterRpcUrls[network];
  if (!apiUrl) {
    throw new Error(`No RPC URL for cluster ${network}`);
  }
  const rpc = createSolanaRpc(apiUrl);

  const usdcInfo = lookupKnownSPLToken(network, "USDC");
  if (!usdcInfo) {
    throw new Error(`Couldn't look up the USDC SPL Token on ${network}`);
  }

  const pyusdInfo = lookupKnownSPLToken(network, "PYUSD");
  if (!pyusdInfo) {
    throw new Error(`Couldn't look up the PYUSD SPL Token on ${network}`);
  }

  const usdcMint = address(usdcInfo.address);
  const pyusdMint = address(pyusdInfo.address);

  handlers.push(
    await createFacilitatorHandlerExact(network, rpc, adminSigner, usdcMint),
    await createFacilitatorHandlerExact(network, rpc, adminSigner, pyusdMint),
  );

  logger.info(`Solana handlers configured for ${network}`);
  return handlers;
}
