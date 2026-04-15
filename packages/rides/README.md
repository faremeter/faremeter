# @faremeter/rides

Low-boilerplate, no-friction API for getting on x402 quick.

## Installation

```bash
pnpm install @faremeter/rides
```

## Features

- Simplest Faremeter integration (3 lines of code)
- Automatic wallet detection (Solana keypair vs EVM private key)
- Multi-chain payment support (Solana, EVM)
- Multiple payment schemes (SPL tokens, EIP-3009 USDC)
- Automatic 402 handling and retry logic
- Batteries included - all payment handlers bundled

## API Reference

<!-- TSDOC_START -->

## Functions

- [createPayer](#createpayer)

### createPayer

Creates a payer instance that manages wallets and payment-enabled fetch.

The payer automatically handles x402 payment flows by wrapping fetch with
payment capabilities. Wallets must be added via addLocalWallet before
making paid requests.

| Function      | Type                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createPayer` | `(args?: CreatePayerArgs or undefined) => { addWalletAdapter: (adapter: WalletAdapter) => void; addLocalWallet: (input: unknown) => Promise<void>; fetch: (input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<...>; }` |

Parameters:

- `args`: - Optional configuration for networks, assets, and fetch behavior

Returns:

A payer object with addLocalWallet and fetch methods

## Constants

- [KnownNetworks](#knownnetworks)
- [KnownAssets](#knownassets)
- [payer](#payer)

### KnownNetworks

| Constant        | Type                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `KnownNetworks` | `readonly ["base", "base-sepolia", "monad", "monad-testnet", "polygon", "polygon-amoy", "solana", "solana-devnet"]` |

### KnownAssets

| Constant      | Type                |
| ------------- | ------------------- |
| `KnownAssets` | `readonly ["USDC"]` |

### payer

Default payer instance with all networks and assets enabled.

Use addLocalWallet to attach wallet credentials before making requests
with the fetch method.

| Constant | Type                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payer`  | `{ addWalletAdapter: (adapter: WalletAdapter) => void; addLocalWallet: (input: unknown) => Promise<void>; fetch: (input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<...>; }` |

## Interfaces

- [WalletAdapter](#walletadapter)
- [PayerAdapter](#payeradapter)
- [CreatePayerArgs](#createpayerargs)

### WalletAdapter

| Property         | Type             | Description |
| ---------------- | ---------------- | ----------- |
| `x402Id`         | `PaymentIdV2[]`  |             |
| `paymentHandler` | `PaymentHandler` |             |
| `getBalance`     | `GetBalance`     |             |

### PayerAdapter

| Property         | Type                                                   | Description |
| ---------------- | ------------------------------------------------------ | ----------- |
| `addLocalWallet` | `(input: unknown) => Promise<WalletAdapter[] or null>` |             |

### CreatePayerArgs

Configuration options for creating a payer instance.

| Property   | Type                                                                                                                                                                                  | Description                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `networks` | `("base" or "base-sepolia" or "monad" or "monad-testnet" or "polygon" or "polygon-amoy" or "solana" or "solana-devnet")[] or undefined`                                               | Networks to enable for payments. Defaults to all known networks. |
| `assets`   | `"USDC"[] or undefined`                                                                                                                                                               | Assets to enable for payments. Defaults to all known assets.     |
| `fetch`    | `{ (input: RequestInfo or URL, init?: RequestInit or undefined): Promise<Response>; (input: string or Request or URL, init?: RequestInit or undefined): Promise<...>; } or undefined` | Custom fetch function to wrap. Defaults to globalThis.fetch.     |
| `options`  | `{ fetch?: WrapOpts or undefined; disableBalanceChecks?: boolean or undefined; } or undefined`                                                                                        | Additional options for fetch wrapping and balance checks.        |

## Types

- [KnownNetwork](#knownnetwork)
- [KnownAsset](#knownasset)
- [Balance](#balance)
- [GetBalance](#getbalance)
- [PaymentIdV2](#paymentidv2)

### KnownNetwork

| Type           | Type                             |
| -------------- | -------------------------------- |
| `KnownNetwork` | `(typeof KnownNetworks)[number]` |

### KnownAsset

| Type         | Type                           |
| ------------ | ------------------------------ |
| `KnownAsset` | `(typeof KnownAssets)[number]` |

### Balance

| Type      | Type                                                  |
| --------- | ----------------------------------------------------- |
| `Balance` | `{ name: string; amount: bigint; decimals: number; }` |

### GetBalance

| Type         | Type                     |
| ------------ | ------------------------ |
| `GetBalance` | `() => Promise<Balance>` |

### PaymentIdV2

| Type          | Type                                                  |
| ------------- | ----------------------------------------------------- |
| `PaymentIdV2` | `{ scheme: string; network: string; asset: string; }` |

<!-- TSDOC_END -->

## Examples

See the [basic example](https://github.com/faremeter/faremeter/blob/main/scripts/rides-example.ts) in the faremeter repository.

## Related Packages

- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Lower-level fetch wrapper
- [@faremeter/middleware](https://www.npmjs.com/package/@faremeter/middleware) - Server-side middleware

## License

LGPL-3.0-only
