# @faremeter/payment-evm

EVM payment scheme implementations for the x402 protocol, supporting EIP-3009 gasless USDC transfers.

## Installation

```bash
pnpm install @faremeter/payment-evm
```

## Features

- Gasless transfers (EIP-3009)
- USDC payments on Base, Polygon, Skale, and more
- EIP-712 typed signatures
- Facilitator pays gas fees
- Secure authorization pattern

## API Reference

<!-- TSDOC_START -->

## Functions

- [getTokenBalance](#gettokenbalance)

### getTokenBalance

Retrieves the ERC-20 token balance and decimals for an account.

Uses multicall to fetch both values in a single RPC request.

| Function          | Type                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `getTokenBalance` | `(args: GetTokenBalanceArgs) => Promise<{ amount: bigint; decimals: number; }>` |

Parameters:

- `args`: - The account, asset, and client configuration

Returns:

The balance amount and token decimals

## Interfaces

- [GetTokenBalanceArgs](#gettokenbalanceargs)

### GetTokenBalanceArgs

Arguments for retrieving an ERC-20 token balance.

| Property  | Type                                                                                                                                                                                                                                                                                                                                       | Description                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `account` | `Address`                                                                                                                                                                                                                                                                                                                                  | The wallet address to check the balance for |
| `asset`   | `Address`                                                                                                                                                                                                                                                                                                                                  | The ERC-20 token contract address           |
| `client`  | `{ account: undefined; batch?: { multicall?: boolean or { batchSize?: number or undefined; deployless?: boolean or undefined; wait?: number or undefined; } or undefined; } or undefined; cacheTime: number; ... 67 more ...; extend: <const client extends { ...; } and ExactPartial<...>>(fn: (client: Client<...>) => client) => Cl...` | Viem public client for querying the chain   |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/wallet-evm](https://www.npmjs.com/package/@faremeter/wallet-evm) - EVM wallet adapter
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper
- [@faremeter/facilitator](https://www.npmjs.com/package/@faremeter/facilitator) - Payment facilitator

## License

LGPL-3.0-only
