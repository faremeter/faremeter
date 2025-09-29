import { type UnitInput, addX402PaymentRequirementDefaults } from "./common";
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

export function lookupX402Network(chainId: number) {
  let k: KnownNetwork;
  for (k in knownNetworks) {
    if (knownNetworks[k].chainId == chainId) {
      return k;
    }
  }

  return ("eip155:" + chainId.toString()) as KnownNetwork;
}

export type ContractInfo = {
  address: Address;
  contractName: string;
};

type AssetInfo = {
  network: Partial<Record<KnownNetwork, ContractInfo>>;
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
    },
    toUnit: (v: UnitInput) => v.toString(),
  },
} as const satisfies Record<string, AssetInfo>;
export type KnownAsset = keyof typeof knownAssets;

export function lookupKnownAsset(
  network: KnownNetwork | number,
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
