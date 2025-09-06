import {
  createPublicClient,
  http,
  createWalletClient,
  isAddress,
  isHex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import type { FacilitatorHandler } from "@faremeter/types";
import { createFacilitatorHandler as createEvmHandler } from "@faremeter/payment-evm";

const { EVM_RECEIVING_ADDRESS, EVM_PRIVATE_KEY, EVM_ASSET_ADDRESS } =
  process.env;

export function createHandlers() {
  const handlers: FacilitatorHandler[] = [];
  // EVM configuration (Base Sepolia)
  if (EVM_RECEIVING_ADDRESS && EVM_PRIVATE_KEY) {
    // Validate private key format
    if (!isHex(EVM_PRIVATE_KEY) || EVM_PRIVATE_KEY.length !== 66) {
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

    const transport = http("https://sepolia.base.org");

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport,
    });

    const account = privateKeyToAccount(EVM_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport,
    });

    handlers.push(
      createEvmHandler(
        "base-sepolia",
        network,
        publicClient,
        walletClient,
        EVM_RECEIVING_ADDRESS,
        EVM_ASSET_ADDRESS,
      ),
    );
    console.log("EVM handler configured for Base Sepolia");
  }
  return handlers;
}
