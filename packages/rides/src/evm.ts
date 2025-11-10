import {
  lookupKnownAsset,
  type KnownAsset,
  type ContractInfo,
} from "@faremeter/info/evm";
import { createLocalWallet } from "@faremeter/wallet-evm";
import { exact } from "@faremeter/payment-evm";
import { isValidationError } from "@faremeter/types";
import { type PaymentHandler } from "@faremeter/types/client";
import { type ChainInfo, PrivateKey } from "@faremeter/types/evm";

import * as chains from "viem/chains";
const networkAliases = new Map<string, ChainInfo>(
  Object.entries({
    base: chains.base,
    "base-sepolia": chains.baseSepolia,
  } as const),
);
export function findNetworkAssetCombinations(
  networks: readonly string[],
  assets: readonly string[],
): { chain: ChainInfo; contractInfo: ContractInfo[] }[] {
  const chains = networks
    .map((n) => networkAliases.get(n))
    .filter((x) => x !== undefined);

  if (chains.length < 1) {
    return [];
  }

  return chains.flatMap((chain) => {
    const contractInfo = assets
      .map((name) => lookupKnownAsset(chain.id, name as KnownAsset))
      .filter((x) => x !== undefined);

    if (contractInfo.length === 0) {
      return [];
    }

    return [
      {
        chain,
        contractInfo,
      },
    ];
  });
}

export type CreateAdapterOptions = {
  networks: readonly string[];
  assets: readonly string[];
};

export function createAdapter(opts: CreateAdapterOptions) {
  const chains = findNetworkAssetCombinations(opts.networks, opts.assets);

  if (chains.length === 0) {
    return undefined;
  }

  return {
    addLocalWallet: async (input: unknown) => {
      const privateKey = PrivateKey(input);

      if (isValidationError(privateKey)) {
        // We don't know what this private key is.
        return null;
      }

      const handlers: PaymentHandler[] = [];

      for (const { chain, contractInfo } of chains) {
        for (const asset of contractInfo) {
          const wallet = await createLocalWallet(chain, privateKey);
          handlers.push(
            exact.createPaymentHandler(wallet, {
              asset,
            }),
          );
        }
      }

      return handlers;
    },
  };
}
