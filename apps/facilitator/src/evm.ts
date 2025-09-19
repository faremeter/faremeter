import { logger } from "./logger";

import { createPublicClient, http, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import { createFacilitatorHandler as createEvmHandler } from "@faremeter/payment-evm/exact";
import { isValidPrivateKey, lookupNetworkConfig } from "@faremeter/wallet-evm";

export async function createHandlers(network: string, privateKey: string) {
  const handlers: FacilitatorHandler[] = [];
  // Validate private key format
  if (!isValidPrivateKey(privateKey)) {
    logger.error(
      "ERROR: EVM private key must be a 32-byte hex string (64 chars + 0x prefix)",
    );
    process.exit(1);
  }

  const networkConfig = lookupNetworkConfig(network);

  if (!networkConfig) {
    logger.error(
      `ERROR: Couldn't lookup configuration for network '${network}'`,
    );
    process.exit(1);
  }

  const transport = http(networkConfig.rpcUrl);

  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport,
  });

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: networkConfig.chain,
    transport,
  });

  handlers.push(
    await createEvmHandler(network, publicClient, walletClient, "USDC"),
  );

  logger.info(`EVM handler configured for ${network}`);
  return handlers;
}
