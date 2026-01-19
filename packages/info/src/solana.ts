import { type UnitInput, addX402PaymentRequirementDefaults } from "./common";
import { Base58Address } from "@faremeter/types/solana";

const knownClusters = ["devnet", "testnet", "mainnet-beta"] as const;
export type KnownCluster = (typeof knownClusters)[number];

export function isKnownCluster(c: string): c is KnownCluster {
  return knownClusters.includes(c as KnownCluster);
}

const knownSolanaNetworks = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": {
    cluster: "mainnet-beta" as const,
    legacyNetworkIds: ["solana-mainnet-beta", "solana"],
  },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": {
    cluster: "devnet" as const,
    legacyNetworkIds: ["solana-devnet"],
  },
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": {
    cluster: "testnet" as const,
    legacyNetworkIds: ["solana-testnet"],
  },
} as const;

type KnownSolanaNetworks = typeof knownSolanaNetworks;
export type SolanaCAIP2Network = keyof KnownSolanaNetworks;

const clusterToCAIP2Map = new Map<KnownCluster, SolanaCAIP2Network>(
  Object.entries(knownSolanaNetworks).map(([caip2, info]) => [
    info.cluster,
    caip2 as SolanaCAIP2Network,
  ]),
);

const legacyNetworkIdToCAIP2Map = new Map<string, SolanaCAIP2Network>();
for (const [caip2, info] of Object.entries(knownSolanaNetworks)) {
  for (const legacyId of info.legacyNetworkIds) {
    legacyNetworkIdToCAIP2Map.set(legacyId, caip2 as SolanaCAIP2Network);
  }
}

export function clusterToCAIP2(cluster: KnownCluster): SolanaCAIP2Network {
  const caip2 = clusterToCAIP2Map.get(cluster);
  if (!caip2) {
    throw new Error(`Unknown Solana cluster: ${cluster}`);
  }
  return caip2;
}

export function caip2ToCluster(caip2: string): KnownCluster | null {
  const network = knownSolanaNetworks[caip2 as SolanaCAIP2Network];
  return network?.cluster ?? null;
}

export function legacyNetworkIdToCAIP2(
  legacy: string,
): SolanaCAIP2Network | null {
  return legacyNetworkIdToCAIP2Map.get(legacy) ?? null;
}

export function caip2ToLegacyNetworkIds(
  caip2: string,
): readonly string[] | null {
  const network = knownSolanaNetworks[caip2 as SolanaCAIP2Network];
  return network?.legacyNetworkIds ?? null;
}

export function normalizeNetworkId(network: string): string {
  if (network.startsWith("solana:")) {
    return network;
  }

  if (isKnownCluster(network)) {
    return clusterToCAIP2(network);
  }

  const caip2 = legacyNetworkIdToCAIP2(network);
  if (caip2) {
    return caip2;
  }

  return network;
}

export function isKnownSolanaCAIP2Network(n: string): n is SolanaCAIP2Network {
  return n in knownSolanaNetworks;
}

export function lookupX402Network(cluster: string): string {
  if (isKnownCluster(cluster)) {
    return clusterToCAIP2(cluster);
  }

  if (cluster.startsWith("solana:")) {
    return cluster;
  }

  const caip2 = legacyNetworkIdToCAIP2(cluster);
  if (caip2) {
    return caip2;
  }

  throw new Error(`Unknown Solana network: ${cluster}`);
}

export function getV1NetworkIds(cluster: KnownCluster): string[] {
  const caip2 = clusterToCAIP2(cluster);
  const legacyIds = caip2ToLegacyNetworkIds(caip2) ?? [];
  return [...legacyIds];
}

type SPLTokenInfo = {
  cluster: Partial<Record<KnownCluster, { address: Base58Address }>>;
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

export type x402ExactArgs = {
  network: KnownCluster;
  asset: KnownSPLToken;
  amount: UnitInput;
  payTo: Base58Address;
};

export function x402Exact(args: x402ExactArgs) {
  const tokenInfo = lookupKnownSPLToken(args.network, args.asset);

  if (!tokenInfo) {
    throw new Error(`couldn't look up token '${args.asset}' on Solana cluster`);
  }

  const networks = getV1NetworkIds(args.network);

  const req = networks.map((network) =>
    addX402PaymentRequirementDefaults({
      scheme: "exact",
      network,
      maxAmountRequired: tokenInfo.toUnit(args.amount),
      payTo: args.payTo,
      asset: tokenInfo.address,
      maxTimeoutSeconds: 60,
    }),
  );

  return req;
}

export type xSolanaSettlementArgs = {
  network: KnownCluster;
  asset: KnownSPLToken | "sol";
  amount: UnitInput;
  payTo: Base58Address;
};

export function xSolanaSettlement(args: xSolanaSettlementArgs) {
  let tokenInfo;

  // Special-case SOL, because it is not an SPL Token.
  if (args.asset === "sol") {
    tokenInfo = {
      address: "sol",
      toUnit: (x: UnitInput) => x.toString(),
    };
  } else {
    tokenInfo = lookupKnownSPLToken(args.network, args.asset);
  }

  if (!tokenInfo) {
    throw new Error(`couldn't look up token '${args.asset}' on Solana cluster`);
  }

  const req = addX402PaymentRequirementDefaults({
    scheme: "@faremeter/x-solana-settlement",
    network: args.network,
    maxAmountRequired: tokenInfo.toUnit(args.amount),
    payTo: args.payTo,
    asset: tokenInfo.address,
    maxTimeoutSeconds: 60,
  });

  return req;
}
