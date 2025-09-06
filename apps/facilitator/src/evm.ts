import { createPublicClient, http, createWalletClient, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { FacilitatorHandler } from "@faremeter/types";
import { createFacilitatorHandler as createEvmHandler } from "@faremeter/payment-evm";
import { isValidPrivateKey, lookupNetworkConfig } from "@faremeter/wallet-evm";

const { EVM_RECEIVING_ADDRESS, EVM_PRIVATE_KEY, EVM_ASSET_ADDRESS } =
  process.env;

export function createHandlers() {
  const handlers: FacilitatorHandler[] = [];
  // EVM configuration (Base Sepolia)
  if (!(EVM_RECEIVING_ADDRESS && EVM_PRIVATE_KEY)) {
    return handlers;
  }
  // Validate private key format
  if (!isValidPrivateKey(EVM_PRIVATE_KEY)) {
    console.error(
      "ERROR: EVM_PRIVATE_KEY must be a 32-byte hex string (64 chars + 0x prefix)",
    );
    process.exit(1);
  }

  // Validate receiving address format
  if (!isAddress(EVM_RECEIVING_ADDRESS)) {
    console.error(
      "ERROR: EVM_RECEIVING_ADDRESS must be a valid Ethereum address",
    );
    process.exit(1);
  }

  const network = "base-sepolia";

  const networkConfig = lookupNetworkConfig(network);

  if (!networkConfig) {
    console.error(
      `ERROR: Couldn't lookup configuration for network '${network}'`,
    );
    process.exit(1);
  }

  const transport = http(networkConfig.rpcUrl);

  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport,
  });

  const account = privateKeyToAccount(EVM_PRIVATE_KEY);
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
      EVM_RECEIVING_ADDRESS,
      EVM_ASSET_ADDRESS,
    ),
  );
  console.log(`EVM handler configured for ${network}`);
  return handlers;
}
