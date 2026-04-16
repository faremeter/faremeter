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

Creates a local Solana wallet from a 64-byte secret key, a kit
`KeyPairSigner`, or a v1 `Keypair` for signing kit-native
transactions.

| Function            | Type                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLocalWallet` | `(network: string, input: LocalWalletInput) => Promise<{ network: string; publicKey: Address; partiallySignTransaction: (tx: Readonly<{ messageBytes: TransactionMessageBytes; signatures: SignaturesMap; }>) => Promise<...>; }>` |

Parameters:

- `network`: - Network identifier (e.g., "mainnet-beta", "devnet").
- `input`: - A 64-byte secret key, kit `KeyPairSigner`, or v1 `Keypair`.

Returns:

A wallet object that can partially sign kit `Transaction`s.

## Types

- [LocalWalletInput](#localwalletinput)
- [LocalWallet](#localwallet)

### LocalWalletInput

| Type               | Type                                         |
| ------------------ | -------------------------------------------- |
| `LocalWalletInput` | `Uint8Array or KeyPairSigner or KeypairLike` |

### LocalWallet

Type representing a local Solana wallet created by {@link createLocalWallet}.

| Type          | Type                                            |
| ------------- | ----------------------------------------------- |
| `LocalWallet` | `Awaited<ReturnType<typeof createLocalWallet>>` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper

## License

LGPL-3.0-only
