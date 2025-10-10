import { type UnitInput, addX402PaymentRequirementDefaults } from "./common";
import { Address } from "@faremeter/types/evm";

const knownX402Networks = {
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
type knownX402Networks = typeof knownX402Networks;
export type KnownX402Network = keyof knownX402Networks;

export function isKnownX402Network(n: string): n is KnownX402Network {
  return n in knownX402Networks;
}

export function lookupKnownX402Network(n: KnownX402Network) {
  return {
    ...knownX402Networks[n],
    name: n,
  };
}

export type x402Network = KnownX402Network | `eip155:${number}`;

export function lookupX402Network(chainId: number) {
  let k: KnownX402Network;
  for (k in knownX402Networks) {
    if (knownX402Networks[k].chainId == chainId) {
      return k;
    }
  }

  return ("eip155:" + chainId.toString()) as x402Network;
}

export type ContractInfo = {
  address: Address;
  contractName: string;
  forwarder?: Address;
  forwarderName?: string;
  forwarderVersion?: string;
};

type AssetInfo = {
  network: Partial<Record<x402Network, ContractInfo>>;
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

export function lookupKnownAsset(
  network: x402Network | number,
  name: KnownAsset,
) {
  const assetInfo: AssetInfo = knownAssets[name];

  if (!assetInfo) {
    return;
  }

  if (typeof network === "number") {
    network = lookupX402Network(network);
  }

  const contractInfo = assetInfo.network[network];

  if (!contractInfo) {
    return;
  }

  return {
    ...contractInfo,
    name,
    network,
    toUnit: assetInfo.toUnit,
  };
}

export function isKnownAsset(asset: string): asset is KnownAsset {
  return asset in knownAssets;
}

export type x402ExactArgs = {
  network: x402Network | number;
  asset: KnownAsset;
  amount: UnitInput;
  payTo: Address;
};

export function x402Exact(args: x402ExactArgs) {
  const tokenInfo = lookupKnownAsset(args.network, args.asset);

  if (!tokenInfo) {
    throw new Error(`couldn't look up token '${args.asset}' on EVM chain`);
  }

  const req = addX402PaymentRequirementDefaults({
    scheme: "exact",
    network: tokenInfo.network,
    maxAmountRequired: tokenInfo.toUnit(args.amount),
    payTo: args.payTo,
    asset: tokenInfo.address,
    maxTimeoutSeconds: 300, // from coinbase/x402's middleware defaults
  });

  return req;
}
