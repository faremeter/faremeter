# @faremeter/payment-solana

Solana payment scheme implementations for the x402 protocol, supporting SPL token transfers.

## Installation

```bash
pnpm install @faremeter/payment-solana
```

## Features

- SPL token payments (USDC, etc.)
- Token-2022 support (PYUSD, etc.) — auto-detected from payment requirements
- Devnet, testnet, and mainnet support
- Automatic fee payer handling
- Transaction verification
- Works with any SPL token

## Exact Payment Scheme

The `exact` module is the primary client-side API for making x402 payments on Solana.

### Quick Start

```typescript
import { Keypair, PublicKey } from "@solana/web3.js";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { createPaymentHandler } from "@faremeter/payment-solana/exact";
import { wrap as wrapFetch } from "@faremeter/fetch";

const wallet = await createLocalWallet("devnet", keypair);
const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // USDC devnet

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet, mint)],
});

const response = await fetchWithPayer("https://api.example.com/protected");
```

For full environment setup (keypairs, funding, facilitator), see the [Quickstart guide](../../QUICKSTART.md).

### `createPaymentHandler(wallet, mint, options?)`

Creates a `PaymentHandler` for use with `@faremeter/fetch`.

| Parameter                                   | Type                | Description                                                                  |
| ------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `wallet`                                    | `Wallet`            | Wallet with signing capabilities (`network`, `publicKey`, and a sign method) |
| `mint`                                      | `PublicKey`         | SPL token mint address                                                       |
| `options.rpc`                               | `Rpc<SolanaRpcApi>` | Optional RPC fallback (see below)                                            |
| `options.features.enableSettlementAccounts` | `boolean`           | Enable settlement account payment mode                                       |

### When do I need `rpc`?

The facilitator provides `decimals` and `recentBlockhash` in the payment requirements, so most setups don't need an RPC client. Pass `rpc` only if your facilitator doesn't provide these fields:

```typescript
import { createSolanaRpc } from "@solana/kit";

createPaymentHandler(wallet, mint, {
  rpc: createSolanaRpc("https://api.devnet.solana.com"),
});
```

### Migrating from `Connection`

The old signature `createPaymentHandler(wallet, mint, connection)` still works but is deprecated. To migrate:

```diff
- import { Connection, clusterApiUrl } from "@solana/web3.js";
- const connection = new Connection(clusterApiUrl("devnet"));
- createPaymentHandler(wallet, mint, connection);
+ createPaymentHandler(wallet, mint);
+ // or, if you need RPC fallback:
+ import { createSolanaRpc } from "@solana/kit";
+ createPaymentHandler(wallet, mint, { rpc: createSolanaRpc("https://api.devnet.solana.com") });
```

### Token-2022

Token-2022 tokens (e.g. PYUSD) work automatically — the facilitator specifies the token program in the payment requirements. No client-side configuration is needed; just pass the Token-2022 mint address.

## SPL Token Utilities

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
