import { match } from "arktype";

import {
  clusterToCAIP2,
  lookupKnownSPLToken,
  type KnownCluster,
  type KnownSPLToken,
} from "@faremeter/info/solana";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { exact } from "@faremeter/payment-solana";
import { type WalletAdapter } from "./types";
import { getTokenBalance } from "@faremeter/payment-solana/splToken";
import { isValidationError } from "@faremeter/types";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type KeyPairSigner,
} from "@solana/kit";
import { readLocalFile } from "./common";

const clusterRpcUrls: Record<KnownCluster, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

const networkAliases = new Map<string, KnownCluster>(
  Object.entries({
    solana: "mainnet-beta",
    "solana-devnet": "devnet",
  } as const),
);

export function findNetworkMintCombinations(
  networks: readonly string[],
  assets: readonly string[],
) {
  const clusters = networks
    .map((n) => networkAliases.get(n))
    .filter((x) => x !== undefined);

  if (clusters.length < 1) {
    return [];
  }

  return clusters.flatMap((cluster) => {
    const mints = assets
      .map((name) => lookupKnownSPLToken(cluster, name as KnownSPLToken))
      .filter((x) => x !== undefined)
      .map(({ address, name }) => ({ address, name }));

    if (mints.length === 0) {
      return [];
    }

    return [
      {
        cluster,
        mints,
      },
    ];
  });
}

export const matchSecretKey = match({
  "TypedArray.Uint8": (x) => x,
  "string.json.parse |> number[] | number[]": (x) => Uint8Array.from(x),
  default: () => undefined,
});

export async function toKeyPairSigner(
  input: unknown,
): Promise<KeyPairSigner | undefined> {
  if (typeof input === "string") {
    const possibleKey = await readLocalFile(input);

    if (possibleKey !== undefined) {
      input = possibleKey;
    }
  }
  const result = matchSecretKey(input);

  if (result === undefined || isValidationError(result)) {
    return undefined;
  }

  return createKeyPairSignerFromBytes(result);
}

export type CreateAdapterOptions = {
  networks: readonly string[];
  assets: readonly string[];
};

export function createAdapter(opts: CreateAdapterOptions) {
  const clusters = findNetworkMintCombinations(opts.networks, opts.assets);

  if (clusters.length === 0) {
    return undefined;
  }

  return {
    addLocalWallet: async (input: unknown) => {
      const signer = await toKeyPairSigner(input);

      if (signer === undefined) {
        // We don't know what this private key is.
        return null;
      }

      const res: WalletAdapter[] = [];

      for (const { cluster, mints } of clusters) {
        const rpcURL = clusterRpcUrls[cluster];
        const rpcClient = createSolanaRpc(rpcURL);

        for (const mint of mints) {
          const wallet = await createLocalWallet(cluster, signer);
          res.push({
            x402Id: [
              {
                scheme: "exact",
                asset: mint.address,
                network: clusterToCAIP2(cluster).caip2,
              },
            ],
            paymentHandler: exact.createPaymentHandler(
              wallet,
              address(mint.address),
              rpcClient,
            ),
            getBalance: async () => {
              let balance = await getTokenBalance({
                account: signer.address,
                asset: mint.address,
                rpcClient,
              });

              balance ??= {
                amount: 0n,
                decimals: 0,
              };

              return {
                ...balance,
                name: mint.name,
              };
            },
          });
        }
      }

      return res;
    },
  };
}
