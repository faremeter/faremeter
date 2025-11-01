import { match } from "arktype";

import type { KnownCluster, KnownSPLToken } from "@faremeter/info/solana";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { type LocalWallet, createLocalWallet } from "@faremeter/wallet-solana";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import { createPaymentHandler } from "@faremeter/payment-solana/exact";
import { wrap as wrapFetch } from "@faremeter/fetch";
import { clusterApiUrl } from "@solana/web3.js";

const toUint8Array = match({
  string: async (fname) => {
    let fs;

    try {
      fs = await import("fs");
    } catch (e) {
      throw new Error("failed to import fs module", { cause: e });
    }

    return Uint8Array.from(JSON.parse(fs.readFileSync(fname, "utf-8")));
  },
  "number[]": (a) => Uint8Array.from(a),
  "TypedArray.Uint8": (a) => a,
  default: "assert",
});

interface PayerOptions {
  networks?: KnownCluster[];
  assets?: KnownSPLToken[];
  fetch?: typeof globalThis.fetch;
}

export function createPayer(opts?: PayerOptions) {
  const {
    networks = ["mainnet-beta"],
    assets = ["USDC"],
    fetch = globalThis.fetch,
  } = opts ?? {};

  const mints = assets.flatMap((asset) =>
    networks.map((network) => {
      const info = lookupKnownSPLToken(network, asset);

      if (!info) {
        throw new Error(`couldn't look up SPL token ${asset} on ${network}!`);
      }

      return new PublicKey(info.address);
    }),
  );

  const connections = new Map<string, Connection>();

  const localWallets: LocalWallet[] = [];

  const setupFetch = () => {
    const handlers = localWallets.flatMap((wallet) => {
      let c = connections.get(wallet.network);
      if (c === undefined) {
        // We know this network is a known cluster, because we
        // just created the wallet.
        c = new Connection(clusterApiUrl(wallet.network as KnownCluster));
        connections.set(wallet.network, c);
      }

      return mints.map((mint) => {
        const h = createPaymentHandler(wallet, mint, c);
        return h;
      });
    });

    return wrapFetch(fetch, {
      handlers,
    });
  };

  let _fetch: typeof fetch | undefined;

  return {
    addLocalWallet: async (input: typeof toUint8Array.inferIn) => {
      const kp = Keypair.fromSecretKey(await toUint8Array(input));

      localWallets.push(
        ...(await Promise.all(
          networks.map((network) => createLocalWallet(network, kp)),
        )),
      );

      _fetch = undefined;
    },
    fetch: async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      _fetch ??= setupFetch();
      return _fetch(input, init);
    },
  };
}

export const payer = createPayer();
