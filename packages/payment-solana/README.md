# @faremeter/payment-solana

Solana payment scheme implementations for the x402 protocol, supporting SPL token transfers.

## Installation

```bash
pnpm install @faremeter/payment-solana
```

## Features

- SPL token payments (USDC, etc.)
- Devnet, testnet, and mainnet support
- Automatic fee payer handling
- Transaction verification
- Works with any SPL token

## API Reference

<!-- TSDOC_START -->

## Functions

- [isAccountNotFoundError](#isaccountnotfounderror)
- [getTokenBalance](#gettokenbalance)

### isAccountNotFoundError

Checks if an error indicates a token account was not found.

This handles various error formats from Solana RPC responses,
including TokenAccountNotFoundError and AccountNotFoundError names,
as well as message-based detection.

| Function                 | Type                      |
| ------------------------ | ------------------------- |
| `isAccountNotFoundError` | `(e: unknown) => boolean` |

Parameters:

- `e`: - The error to check

Returns:

True if the error indicates the account does not exist

### getTokenBalance

Retrieves the SPL token balance for an account.

Looks up the associated token account (ATA) for the given wallet and
mint, then fetches the token balance. Returns null if the account
does not exist.

| Function          | Type                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `getTokenBalance` | `(args: GetTokenBalanceArgs) => Promise<{ amount: bigint; decimals: any; } or null>` |

Parameters:

- `args`: - The asset, account, and RPC client

Returns:

The balance amount and decimals, or null if the account does not exist

## Constants

- [TOKEN_2022_PROGRAM_ADDRESS](#token_2022_program_address)

### TOKEN_2022_PROGRAM_ADDRESS

| Constant                     | Type                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `TOKEN_2022_PROGRAM_ADDRESS` | `Address<"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb">` |

## Interfaces

- [GetTokenBalanceArgs](#gettokenbalanceargs)

### GetTokenBalanceArgs

Arguments for retrieving an SPL token balance.

| Property       | Type                             | Description                                                   |
| -------------- | -------------------------------- | ------------------------------------------------------------- |
| `asset`        | `Base58Address`                  | The SPL token mint address                                    |
| `account`      | `Base58Address`                  | The wallet address to check the balance for                   |
| `rpcClient`    | `Rpc<GetTokenAccountBalanceApi>` | Solana RPC client with token balance API support              |
| `tokenProgram` | `Address or undefined`           | The token program address (defaults to TOKEN_PROGRAM_ADDRESS) |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/wallet-solana](https://www.npmjs.com/package/@faremeter/wallet-solana) - Solana wallet adapter
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper
- [@faremeter/facilitator](https://www.npmjs.com/package/@faremeter/facilitator) - Payment facilitator

## License

LGPL-3.0-only
