import { type UnitInput } from "./common";

const knownClusters = ["devnet", "testnet", "mainnet-beta"] as const;
type knownClusters = typeof knownClusters;
export type KnownCluster = (typeof knownClusters)[number];

export function isKnownCluster(c: string): c is KnownCluster {
  return knownClusters.includes(c as KnownCluster);
}

type SPLTokenInfo = {
  cluster: Partial<Record<KnownCluster, { address: string }>>;
  toUnit: (v: UnitInput) => string;
};

const knownSPLTokens = {
  USDC: {
    cluster: {
      "mainnet-beta": {
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      },
      devnet: {
        address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      },
    },
    toUnit: (v: UnitInput) => v.toString(),
  },
} as const satisfies Record<string, SPLTokenInfo>;
export type KnownSPLToken = keyof typeof knownSPLTokens;

export function lookupKnownSPLToken(
  cluster: KnownCluster,
  name: KnownSPLToken,
) {
  const splTokenInfo: SPLTokenInfo = knownSPLTokens[name];

  if (!splTokenInfo) {
    return;
  }

  const networkInfo = splTokenInfo.cluster[cluster];

  if (!networkInfo) {
    return;
  }

  return {
    ...networkInfo,
    cluster,
    name,
    toUnit: splTokenInfo.toUnit,
  };
}

export function isKnownSPLToken(splToken: string): splToken is KnownSPLToken {
  return splToken in knownSPLTokens;
}
