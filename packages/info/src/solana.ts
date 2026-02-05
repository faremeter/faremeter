import { type UnitInput, addX402PaymentRequirementDefaults } from "./common";
import {
  type SolanaCluster,
  type SolanaCAIP2Network,
  Base58Address,
  isSolanaCluster,
  isSolanaCAIP2Network,
} from "@faremeter/types/solana";

export type { SolanaCluster, SolanaCAIP2Network };

export type KnownCluster = SolanaCluster;

export { isSolanaCluster, isSolanaCAIP2Network };

export function isKnownCluster(c: string): c is KnownCluster {
  return isSolanaCluster(c);
}

const knownSolanaNetworks = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": {
    cluster: "mainnet-beta" as const,
    legacyNetworkIds: ["solana-mainnet-beta", "solana"] as const,
  },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": {
    cluster: "devnet" as const,
    legacyNetworkIds: ["solana-devnet"] as const,
  },
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": {
    cluster: "testnet" as const,
    legacyNetworkIds: ["solana-testnet"] as const,
  },
} as const;

export type KnownSolanaCAIP2Network = keyof typeof knownSolanaNetworks;

/**
 * Type guard that checks if a string is a known Solana CAIP-2 network.
 *
 * @param n - The string to check
 * @returns True if the string is a known Solana CAIP-2 network identifier
 */
export function isKnownSolanaCAIP2Network(
  n: string,
): n is KnownSolanaCAIP2Network {
  return n in knownSolanaNetworks;
}

const clusterToCAIP2Map = new Map<SolanaCluster, KnownSolanaCAIP2Network>(
  (Object.keys(knownSolanaNetworks) as KnownSolanaCAIP2Network[]).map(
    (caip2) => [knownSolanaNetworks[caip2].cluster, caip2],
  ),
);

const legacyNetworkIdToCAIP2Map = new Map<string, KnownSolanaCAIP2Network>();
for (const caip2 of Object.keys(
  knownSolanaNetworks,
) as KnownSolanaCAIP2Network[]) {
  for (const legacyId of knownSolanaNetworks[caip2].legacyNetworkIds) {
    legacyNetworkIdToCAIP2Map.set(legacyId, caip2);
  }
}

/**
 * Converts a Solana cluster name to CAIP-2 network identifier.
 *
 * @param cluster - The Solana cluster name
 * @returns The corresponding CAIP-2 network identifier
 * @throws Error if the cluster is unknown
 */
export function clusterToCAIP2(
  cluster: SolanaCluster,
): KnownSolanaCAIP2Network {
  const caip2 = clusterToCAIP2Map.get(cluster);
  if (!caip2) {
    throw new Error(`Unknown Solana cluster: ${cluster}`);
  }
  return caip2;
}

/**
 * Converts a CAIP-2 network identifier to Solana cluster name.
 *
 * @param caip2 - The CAIP-2 network identifier
 * @returns The cluster name, or null if not a known Solana network
 */
export function caip2ToCluster(caip2: string): SolanaCluster | null {
  if (!isKnownSolanaCAIP2Network(caip2)) {
    return null;
  }
  return knownSolanaNetworks[caip2].cluster;
}

/**
 * Converts a legacy Solana network ID to CAIP-2 format.
 *
 * @param legacy - Legacy network identifier (e.g., "solana-mainnet-beta")
 * @returns The CAIP-2 network identifier, or null if unknown
 */
export function legacyNetworkIdToCAIP2(
  legacy: string,
): KnownSolanaCAIP2Network | null {
  return legacyNetworkIdToCAIP2Map.get(legacy) ?? null;
}

/**
 * Converts a CAIP-2 network identifier to legacy Solana network IDs.
 *
 * @param caip2 - The CAIP-2 network identifier
 * @returns Array of legacy network IDs, or null if unknown
 */
export function caip2ToLegacyNetworkIds(
  caip2: string,
): readonly string[] | null {
  if (!isKnownSolanaCAIP2Network(caip2)) {
    return null;
  }
  return knownSolanaNetworks[caip2].legacyNetworkIds;
}

/**
 * Normalizes a Solana network identifier to CAIP-2 format.
 *
 * Accepts cluster names, legacy IDs, or CAIP-2 identifiers.
 * Returns the input unchanged if no mapping exists.
 *
 * @param network - The network identifier in any supported format
 * @returns The CAIP-2 network identifier, or the original string if unrecognized
 */
export function normalizeNetworkId(network: string): string {
  if (isSolanaCAIP2Network(network)) {
    return network;
  }

  if (isSolanaCluster(network)) {
    return clusterToCAIP2(network);
  }

  const caip2 = legacyNetworkIdToCAIP2(network);
  if (caip2) {
    return caip2;
  }

  return network;
}

/**
 * Looks up the x402 network identifier for a Solana cluster.
 *
 * Accepts a cluster name, CAIP-2 identifier, or legacy network ID and returns
 * a branded SolanaCAIP2Network type.
 *
 * @param network - Cluster name, CAIP-2 ID, or legacy network ID
 * @returns The CAIP-2 network identifier as a branded type
 * @throws Error if the network is unknown or invalid
 */
export function lookupX402Network(network: string): SolanaCAIP2Network {
  if (isSolanaCluster(network)) {
    return clusterToCAIP2(network);
  }

  if (isSolanaCAIP2Network(network)) {
    return network;
  }

  const caip2 = legacyNetworkIdToCAIP2(network);
  if (caip2) {
    return caip2;
  }

  throw new Error(`Unknown Solana network: ${network}`);
}

/**
 * Gets the v1 legacy network IDs for a Solana cluster.
 *
 * @param cluster - The Solana cluster name
 * @returns Array of legacy network IDs for v1 compatibility
 */
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

/**
 * Looks up SPL token information by cluster and token name.
 *
 * @param cluster - The Solana cluster
 * @param name - The known SPL token name (e.g., "USDC")
 * @returns Token information including address, or undefined if not found
 */
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

/**
 * Type guard that checks if a string is a known SPL token name.
 *
 * @param splToken - The string to check
 * @returns True if the string is a known SPL token
 */
export function isKnownSPLToken(splToken: string): splToken is KnownSPLToken {
  return splToken in knownSPLTokens;
}

export type x402ExactArgs = {
  network: KnownCluster;
  asset: KnownSPLToken;
  amount: UnitInput;
  payTo: Base58Address;
};

/**
 * Creates x402 exact payment requirements for Solana.
 *
 * Returns multiple requirements for v1 compatibility (one per legacy network ID).
 *
 * @param args - Payment configuration including network, asset, amount, and payTo
 * @returns Array of x402 payment requirements
 */
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

/**
 * Creates x-solana-settlement payment requirements.
 *
 * Supports both SPL tokens and native SOL.
 *
 * @param args - Payment configuration including network, asset, amount, and payTo
 * @returns x402 payment requirement for the settlement scheme
 */
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
