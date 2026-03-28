# @faremeter/wallet-ows

Open Wallet Standard (OWS) integration for Faremeter payments on Solana and EVM.

## Installation

```bash
pnpm install @faremeter/wallet-ows
```

## Features

- Vault-backed transaction signing via Open Wallet Standard
- Solana transaction signing
- EVM EIP-712 typed data signing
- Passphrase-protected key access

## API Reference

<!-- TSDOC_START -->

## Functions

- [createOWSEvmWallet](#createowsevmwallet)
- [createOWSSolanaWallet](#createowssolanawallet)

### createOWSEvmWallet

Creates an OWS-backed EVM wallet.

Uses the Open Wallet Standard vault for EIP-712 typed data signing.
The passphrase is closed over and used for each signing operation.

XXX - OWS signing calls are synchronous and block the event loop.
Consider wrapping in worker_threads if this becomes a bottleneck.

| Function             | Type                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createOWSEvmWallet` | `(chain: ChainInfo, opts: OWSWalletOpts, getWallet?: (nameOrId: string, vaultPathOpt?: string or null or undefined) => WalletInfo) => OWSEvmWallet` |

Parameters:

- `chain`: - EVM chain configuration.
- `opts`: - OWS wallet options (wallet name/ID, passphrase, vault path).
- `getWallet`: - Optional wallet lookup function for testability.

Returns:

An EVM wallet that delegates signing to OWS.

### createOWSSolanaWallet

Creates an OWS-backed Solana wallet.

Uses the Open Wallet Standard vault for transaction signing.
The passphrase is closed over and used for each signing operation.

XXX - OWS signing calls are synchronous and block the event loop.
Consider wrapping in worker_threads if this becomes a bottleneck.

| Function                | Type                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createOWSSolanaWallet` | `(network: string, opts: OWSWalletOpts, getWallet?: (nameOrId: string, vaultPathOpt?: string or null or undefined) => WalletInfo) => OWSSolanaWallet` |

Parameters:

- `network`: - Solana network identifier (e.g., "mainnet-beta", "devnet").
- `opts`: - OWS wallet options (wallet name/ID, passphrase, vault path).
- `getWallet`: - Optional wallet lookup function for testability.

Returns:

A Solana wallet that delegates signing to OWS.

## Interfaces

- [OWSSolanaWallet](#owssolanawallet)
- [OWSEvmWallet](#owsevmwallet)

### OWSSolanaWallet

OWS wallet interface for Solana.

XXX: OWS signing calls are synchronous/blocking under the hood.

| Property                   | Type                                                          | Description |
| -------------------------- | ------------------------------------------------------------- | ----------- |
| `network`                  | `string`                                                      |             |
| `publicKey`                | `PublicKey`                                                   |             |
| `partiallySignTransaction` | `(tx: VersionedTransaction) => Promise<VersionedTransaction>` |             |
| `updateTransaction`        | `(tx: VersionedTransaction) => Promise<VersionedTransaction>` |             |

### OWSEvmWallet

OWS wallet interface for EVM chains.

XXX: OWS signing calls are synchronous/blocking under the hood.

| Property  | Type                                                                                                                                                                                  | Description |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `chain`   | `ChainInfo`                                                                                                                                                                           |             |
| `address` | `0x${string}`                                                                                                                                                                         |             |
| `account` | `{ signTypedData: (params: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown>; }) => Promise<`0x${string}`>; }` |             |

## Types

- [OWSWalletOpts](#owswalletopts)

### OWSWalletOpts

| Type            | Type                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `OWSWalletOpts` | `{ walletNameOrId: string; passphrase: string; vaultPath?: string; }` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/wallet-solana](https://www.npmjs.com/package/@faremeter/wallet-solana) - Local keypair Solana wallet
- [@faremeter/wallet-evm](https://www.npmjs.com/package/@faremeter/wallet-evm) - Local private key EVM wallet
- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/payment-evm](https://www.npmjs.com/package/@faremeter/payment-evm) - EVM payment handler
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper

## License

LGPL-3.0-only
