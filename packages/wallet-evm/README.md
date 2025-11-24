# @faremeter/wallet-evm

EVM private key wallet adapter for Faremeter payments using viem.

## Installation

```bash
pnpm install @faremeter/wallet-evm
```

## Features

- Private key signing with viem
- Multi-chain support (Base, Skale, etc.)
- EIP-712 signature support
- Compatible with @faremeter/payment-evm

## API Reference

<!-- TSDOC_START -->

## Functions

- [createLocalWallet](#createlocalwallet)

### createLocalWallet

| Function            | Type                                                           |
| ------------------- | -------------------------------------------------------------- |
| `createLocalWallet` | `(chain: ChainInfo, privateKey: string) => Promise<EvmWallet>` |

## Interfaces

- [EvmWallet](#evmwallet)

### EvmWallet

| Property  | Type                                                                                                                                                                                                                                                                                                                                        | Description |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `chain`   | `ChainInfo`                                                                                                                                                                                                                                                                                                                                 |             |
| `address` | `0x${string}`                                                                                                                                                                                                                                                                                                                               |             |
| `client`  | `{ account: Account or undefined; batch?: { multicall?: boolean or { batchSize?: number or undefined; deployless?: boolean or undefined; wait?: number or undefined; } or undefined; } or undefined; ... 34 more ...; extend: <const client extends { ...; } and ExactPartial<...>>(fn: (client: Client<...>) => client) => Client<...>...` |             |
| `account` | `{ address: `0x${string}`; nonceManager?: NonceManager or undefined; sign: (parameters: { hash: `0x${string}`; }) => Promise<`0x${string}`>; signAuthorization: (parameters: AuthorizationRequest) => Promise<...>; ... 5 more ...; type: "local"; }`                                                                                       |             |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/payment-evm](https://www.npmjs.com/package/@faremeter/payment-evm) - EVM payment handler
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper

## License

LGPL-3.0-only
