import { type UnitInput, addX402PaymentRequirementDefaults } from "./common";
import { Address } from "@faremeter/types/evm";

const knownNetworks = {
  base: {
    chainId: 8453,
  },
  "base-sepolia": {
    chainId: 84532,
  },
  "skale-europa-testnet": {
    chainId: 1444673419,
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

type NetworkInfo = {
  address: Address;
  contractName: string;
  forwarder?: Address;
  forwarderName?: string;
  forwarderVersion?: string;
};

type AssetInfo = {
  network: Partial<Record<KnownNetwork, NetworkInfo>>;
  toUnit: (v: UnitInput) => string;
};

const knownAssets = {
  USDC: {
    network: {
      "base-sepolia": {
        address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        contractName: "USDC",
      },
      base: {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        contractName: "USD Coin",
      },
      "skale-europa-testnet": {
        address: "0x9eAb55199f4481eCD7659540A17Af618766b07C4",
        contractName: "USDC", // EIP-3009 Forwarder,
        forwarder: "0x7779B0d1766e6305E5f8081E3C0CDF58FcA24330",
        forwarderName: "USDC Forwarder",
        forwarderVersion: "1",
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

export type x402ExactArgs = {
  network: KnownNetwork;
  asset: KnownAsset;
  amount: UnitInput;
  payTo: Address;
};

export function x402Exact(args: x402ExactArgs) {
  const tokenInfo = lookupKnownAsset(args.network, args.asset);

  if (!tokenInfo) {
    throw new Error(`couldn't look up token '${args.asset}' on Solana cluster`);
  }

  const req = addX402PaymentRequirementDefaults({
    scheme: "exact",
    network: args.network,
    maxAmountRequired: tokenInfo.toUnit(args.amount),
    payTo: args.payTo,
    asset: tokenInfo.address,
    maxTimeoutSeconds: 300, // from coinbase/x402's middleware defaults
  });

  return req;
}
