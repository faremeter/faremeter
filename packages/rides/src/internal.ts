import { type PaymentHandler } from "@faremeter/types/client";
import { wrap as wrapFetch, type WrapOpts } from "@faremeter/fetch";
import {
  KnownNetworks,
  type KnownNetwork,
  KnownAssets,
  type KnownAsset,
  type PayerAdapter,
} from "./types";

import * as solana from "./solana";
import * as evm from "./evm";

export interface CreatePayerArgs {
  networks?: KnownNetwork[];
  assets?: KnownAsset[];
  fetch?: typeof globalThis.fetch;
  options?: {
    fetch?: WrapOpts;
  };
}

export function createPayer(args?: CreatePayerArgs) {
  const {
    networks = KnownNetworks,
    assets = KnownAssets,
    fetch = globalThis.fetch,
  } = args ?? {};

  const paymentHandlers: PaymentHandler[] = [];

  const adapters: PayerAdapter[] = [];

  for (const plugin of [solana, evm]) {
    const adapter = plugin.createAdapter({ networks, assets });

    if (adapter !== undefined) {
      adapters.push(adapter);
    }
  }

  const setupFetch = () => {
    if (paymentHandlers.length < 1) {
      throw new Error("no usable wallets have been attached to enable payment");
    }

    return wrapFetch(fetch, {
      ...(args?.options?.fetch ?? {}),
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

      const newHandlers = [];

      for (const adapter of adapters) {
        const res = await adapter.addLocalWallet(input);
        if (res === null) {
          continue;
        }

        newHandlers.push(...res);
      }

      if (newHandlers.length === 0) {
        throw new Error(
          "couldn't find any way to use provided local wallet information",
        );
      }

      paymentHandlers.push(...newHandlers);
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
