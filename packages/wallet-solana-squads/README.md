# @faremeter/wallet-solana-squads

Solana Squads Protocol multisig wallet integration for DAO and shared treasury payments.

## Installation

```bash
pnpm install @faremeter/wallet-solana-squads
```

## Features

- Multisig wallet support
- Squads Protocol integration
- Proposal and approval flow
- Threshold signatures

## API Reference

<!-- TSDOC_START -->

## Functions

- [createSquadsWallet](#createsquadswallet)

### createSquadsWallet

| Function             | Type                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSquadsWallet` | `(network: string, connection: Connection, keypair: Keypair, multisigPda: PublicKey, squadMember: Keypair) => Promise<{ network: string; publicKey: PublicKey; buildTransaction: (instructions: TransactionInstruction[]) => Promise<...>; }>` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper

## License

LGPL-3.0-only
