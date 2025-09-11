import { type UnitInput } from "./common";
import { Address } from "@faremeter/types/evm";

const knownNetworks = {
  base: {
    chainId: 8453,
  },
  "base-sepolia": {
    chainId: 84532,
  },
} as const;
type knownNetworks = typeof knownNetworks;
export type KnownNetwork = keyof knownNetworks;

export function isKnownNetwork(n: string): n is KnownNetwork {
  return n in knownNetworks;
}

export function lookupKnownNetwork(n: KnownNetwork) {
  return {
    ...knownNetworks[n],
    name: n,
  };
}

type AssetInfo = {
  network: Partial<Record<KnownNetwork, { address: Address }>>;
  toUnit: (v: UnitInput) => string;
};

const knownAssets = {
  USDC: {
    network: {
      "base-sepolia": {
        address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      },
      base: {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    },
    toUnit: (v: UnitInput) => v.toString(),
  },
} as const satisfies Record<string, AssetInfo>;
export type KnownAsset = keyof typeof knownAssets;

export function lookupKnownAsset(network: KnownNetwork, name: KnownAsset) {
  const assetInfo: AssetInfo = knownAssets[name];

  if (!assetInfo) {
    return;
  }

  const networkInfo = assetInfo.network[network];

  if (!networkInfo) {
    return;
  }

  return {
    ...networkInfo,
    name,
    network,
    toUnit: assetInfo.toUnit,
  };
}

export function isKnownAsset(asset: string): asset is KnownAsset {
  return asset in knownAssets;
}
