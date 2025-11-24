# @faremeter/wallet-solana

Solana keypair wallet adapter for Faremeter payments.

## Installation

```bash
pnpm install @faremeter/wallet-solana
```

## Features

- Local keypair signing
- Network configuration (devnet, mainnet-beta)
- Compatible with @faremeter/payment-solana

## API Reference

<!-- TSDOC_START -->

## Functions

- [createLocalWallet](#createlocalwallet)

### createLocalWallet

| Function            | Type                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLocalWallet` | `(network: string, keypair: Keypair) => Promise<{ network: string; publicKey: PublicKey; updateTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>; }>` |

## Types

- [LocalWallet](#localwallet)

### LocalWallet

| Type          | Type                                            |
| ------------- | ----------------------------------------------- |
| `LocalWallet` | `Awaited<ReturnType<typeof createLocalWallet>>` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper

## License

LGPL-3.0-only
