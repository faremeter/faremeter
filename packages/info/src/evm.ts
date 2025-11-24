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
      // Polygon PoS
      "eip155:137": {
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        contractName: "USD Coin",
      },
      // Polygon PoS Amoy
      "eip155:80002": {
        address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
        contractName: "USDC",
      },
      // Monad Mainnet
      "eip155:143": {
        address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
        contractName: "USDC",
      },
      // Monad Testnet
      "eip155:10143": {
        address: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
        contractName: "USDC",
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

export type AssetNameOrContractInfo = string | ContractInfo;

export function findAssetInfo(
  network: x402Network,
  assetNameOrInfo: AssetNameOrContractInfo,
) {
  let assetInfo: ContractInfo;

  if (typeof assetNameOrInfo == "string") {
    if (!isKnownAsset(assetNameOrInfo)) {
      throw new Error(`Unknown asset: ${assetNameOrInfo}`);
    }

    const t = lookupKnownAsset(network, assetNameOrInfo);

    if (!t) {
      throw new Error(
        `Couldn't look up asset ${assetNameOrInfo} on ${network}`,
      );
    }

    assetInfo = t;
  } else {
    assetInfo = assetNameOrInfo;
  }

  return assetInfo;
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
