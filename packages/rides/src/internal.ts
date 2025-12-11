import { x402PaymentId } from "@faremeter/types/x402";
import { type PaymentHandler } from "@faremeter/types/client";
import {
  wrap as wrapFetch,
  type WrapOpts,
  chooseFirstAvailable,
} from "@faremeter/fetch";

import { type PaymentExecer } from "@faremeter/types/client";

import {
  KnownNetworks,
  type KnownNetwork,
  KnownAssets,
  type KnownAsset,
  type PayerAdapter,
  type GetBalance,
} from "./types";

import * as solana from "./solana";
import * as evm from "./evm";

export interface CreatePayerArgs {
  networks?: KnownNetwork[];
  assets?: KnownAsset[];
  fetch?: typeof globalThis.fetch;
  options?: {
    fetch?: WrapOpts;
    disableBalanceChecks?: boolean;
  };
}

function idKey({ network, scheme, asset }: x402PaymentId) {
  return `${network}\0${scheme}\0${asset}`;
}

export function createPayer(args?: CreatePayerArgs) {
  const {
    networks = KnownNetworks,
    assets = KnownAssets,
    fetch = globalThis.fetch,
  } = args ?? {};

  const paymentHandlers: PaymentHandler[] = [];
  const balanceLookup = new Map<string, GetBalance>();

  const adapters: PayerAdapter[] = [];

  for (const plugin of [solana, evm]) {
    const adapter = plugin.createAdapter({ networks, assets });

    if (adapter !== undefined) {
      adapters.push(adapter);
    }
  }

  const wrapFetchOptions = {
    ...(args?.options?.fetch ?? {}),
  };

  if (!args?.options?.disableBalanceChecks) {
    const finalChooser =
      args?.options?.fetch?.payerChooser ?? chooseFirstAvailable;

    wrapFetchOptions.payerChooser = async function (execer: PaymentExecer[]) {
      const viableOptions = [];
      for (const e of execer) {
        const req = e.requirements;
        const getBalance = balanceLookup.get(idKey(req));

        if (getBalance === undefined) {
          continue;
        }

        const balance = await getBalance();

        // XXX - We need to do a better job of understanding decimals here.
        if (balance.amount < BigInt(req.maxAmountRequired)) {
          // eslint-disable-next-line no-console
          console.log(
            `Not paying with ${balance.name} on ${req.network} using the ${req.scheme} scheme: balance is ${balance.amount} which is less than ${req.maxAmountRequired}`,
          );

          continue;
        }

        viableOptions.push(e);
      }

      return finalChooser(viableOptions);
    };
  }

  const setupFetch = () => {
    if (paymentHandlers.length < 1) {
      throw new Error("no usable wallets have been attached to enable payment");
    }

    return wrapFetch(fetch, {
      ...wrapFetchOptions,
      handlers: paymentHandlers,
    });
  };

  let _fetch: typeof fetch | undefined;

  return {
    addLocalWallet: async (input: unknown) => {
      if (input === undefined) {
        throw new Error("undefined is not a valid local wallet");
      }

      _fetch = undefined;

      const newWallets = [];

      for (const adapter of adapters) {
        const res = await adapter.addLocalWallet(input);
        if (res === null) {
          continue;
        }

        newWallets.push(...res);
      }

      if (newWallets.length === 0) {
        throw new Error(
          "couldn't find any way to use provided local wallet information",
        );
      }

      paymentHandlers.push(...newWallets.map((x) => x.paymentHandler));

      for (const wallet of newWallets) {
        for (const id of wallet.x402Id) {
          balanceLookup.set(idKey(id), wallet.getBalance);
        }
      }
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
