import { type UnitInput, addX402PaymentRequirementDefaults } from "./common";
import { Base58Address } from "@faremeter/types/solana";

const knownClusters = ["devnet", "testnet", "mainnet-beta"] as const;
type knownClusters = typeof knownClusters;
export type KnownCluster = (typeof knownClusters)[number];

export function isKnownCluster(c: string): c is KnownCluster {
  return knownClusters.includes(c as KnownCluster);
}

export const lookupX402Network = (network: string) => {
  return `solana-${network}`;
};

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

  const req = addX402PaymentRequirementDefaults({
    scheme: "exact",
    network: `solana-${args.network}`,
    maxAmountRequired: tokenInfo.toUnit(args.amount),
    payTo: args.payTo,
    asset: tokenInfo.address,
    maxTimeoutSeconds: 60, // from coinbase/x402's middleware defaults
  });

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

  // Special-case this, because it's not an SPL Token.
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
    maxTimeoutSeconds: 60, // from coinbase/x402's middleware defaults
  });

  return req;
}
