import { logger } from "./logger";

import { createPublicClient, http, createWalletClient, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { FacilitatorHandler } from "@faremeter/types";
import { createFacilitatorHandler as createEvmHandler } from "@faremeter/payment-evm";
import { isValidPrivateKey, lookupNetworkConfig } from "@faremeter/wallet-evm";

export function createHandlers(
  network: string,
  privateKey: string,
  receivingAddress: string,
  assetAddress: string,
) {
  const handlers: FacilitatorHandler[] = [];
  if (!isValidPrivateKey(privateKey)) {
    logger.error(
      "ERROR: EVM private key must be a 32-byte hex string (64 chars + 0x prefix)",
    );
    process.exit(1);
  }

  if (!isAddress(receivingAddress)) {
    logger.error(
      "ERROR: EVM receiving address must be a valid Ethereum address",
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
    createEvmHandler(
      network,
      publicClient,
      walletClient,
      receivingAddress,
      assetAddress,
    ),
  );

  logger.info(`EVM handler configured for ${network}`);
  return handlers;
}
