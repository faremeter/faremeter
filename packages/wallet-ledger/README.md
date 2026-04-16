# @faremeter/wallet-ledger

Ledger hardware wallet integration for secure Faremeter payments on Solana and EVM.

## Installation

```bash
pnpm install @faremeter/wallet-ledger
```

## Features

- Hardware wallet security
- Account selection
- Transaction signing with user confirmation

## API Reference

<!-- TSDOC_START -->

## Functions

- [createLedgerEvmWallet](#createledgerevmwallet)
- [createLedgerSolanaWallet](#createledgersolanawallet)
- [selectLedgerAccount](#selectledgeraccount)
- [createReadlineInterface](#createreadlineinterface)

### createLedgerEvmWallet

Creates a Ledger hardware wallet interface for EVM chains.

Connects to a Ledger device and returns a wallet that can sign
transactions and EIP-712 typed data.

| Function                | Type                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `createLedgerEvmWallet` | `(ui: UserInterface, chain: ChainInfo, derivationPath: string) => Promise<LedgerEvmWallet>` |

Parameters:

- `ui`: - User interface for displaying prompts and messages.
- `chain`: - EVM chain configuration.
- `derivationPath`: - BIP-44 derivation path (e.g., "m/44'/60'/0'/0/0").

Returns:

A Ledger EVM wallet interface.

### createLedgerSolanaWallet

Creates a Ledger hardware wallet interface for Solana.

Connects to a Ledger device and returns a wallet that can sign
kit-native Solana transactions.

| Function                   | Type                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `createLedgerSolanaWallet` | `(network: string, derivationPath: string) => Promise<LedgerSolanaWallet>` |

Parameters:

- `network`: - Solana network identifier (e.g., "mainnet-beta", "devnet").
- `derivationPath`: - BIP-44 derivation path (e.g., "44'/501'/0'").

Returns:

A Ledger Solana wallet interface.

### selectLedgerAccount

Interactively selects a Ledger account from the device.

Enumerates accounts on the connected Ledger device and prompts the
user to select one via the provided user interface.

| Function              | Type                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `selectLedgerAccount` | `(ui: UserInterface, type: "evm" or "solana", numAccounts?: number) => Promise<{ path: string; address: string; } or null>` |

Parameters:

- `ui`: - User interface for displaying accounts and receiving selection.
- `type`: - Account type to enumerate ("evm" or "solana").
- `numAccounts`: - Number of accounts to scan (default: 5).

Returns:

The selected account's derivation path and address, or null if selection cancelled.

### createReadlineInterface

Creates a readline-based user interface for Ledger interactions.

Provides a simple terminal interface for displaying messages and
prompting for user input during account selection.

| Function                  | Type                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReadlineInterface` | `(args: createReadlineInterfaceArgs) => Promise<{ message: (msg: string) => undefined; question: (q: string) => Promise<string>; close: () => Promise<void>; }>` |

Parameters:

- `args`: - Input and output streams for the readline interface.

Returns:

A UserInterface implementation using Node.js readline.

## Interfaces

- [LedgerEvmWallet](#ledgerevmwallet)
- [LedgerSolanaWallet](#ledgersolanawallet)
- [LedgerTransportWrapper](#ledgertransportwrapper)
- [UserInterface](#userinterface)

### LedgerEvmWallet

Ledger hardware wallet interface for EVM chains.

| Property          | Type                                                                                                                                                                                                                                                                                                                               | Description |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `chain`           | `ChainInfo`                                                                                                                                                                                                                                                                                                                        |             |
| `address`         | `0x${string}`                                                                                                                                                                                                                                                                                                                      |             |
| `signTransaction` | `(tx: TransactionSerializable) => Promise<`0x${string}`>`                                                                                                                                                                                                                                                                          |             |
| `signTypedData`   | `(params: MessageDefinition<{ [x: string]: readonly TypedDataParameter[]; [x: `string[${string}]`]: undefined; [x: `function[${string}]`]: undefined; [x: `address[${string}]`]: undefined; [x: `bool[${string}]`]: undefined; [x: `bytes[${string}]`]: undefined; [x: `bytes1[${string}]`]: undefined; [x: `bytes2[${string}]...` |             |
| `disconnect`      | `() => Promise<void>`                                                                                                                                                                                                                                                                                                              |             |

### LedgerSolanaWallet

Ledger hardware wallet interface for Solana.

| Property                   | Type                                                                                                                                                                                | Description |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `network`                  | `string`                                                                                                                                                                            |             |
| `publicKey`                | `Address`                                                                                                                                                                           |             |
| `partiallySignTransaction` | `(tx: Readonly<{ messageBytes: TransactionMessageBytes; signatures: SignaturesMap; }>) => Promise<Readonly<{ messageBytes: TransactionMessageBytes; signatures: SignaturesMap; }>>` |             |
| `disconnect`               | `() => Promise<void>`                                                                                                                                                               |             |

### LedgerTransportWrapper

| Property    | Type                  | Description |
| ----------- | --------------------- | ----------- |
| `transport` | `Transport`           |             |
| `close`     | `() => Promise<void>` |             |

### UserInterface

User interface abstraction for Ledger interactions.

Used to display prompts and receive user input during
device selection and account enumeration.

| Property   | Type                                  | Description                                            |
| ---------- | ------------------------------------- | ------------------------------------------------------ |
| `message`  | `(msg: string) => void`               | Displays a message to the user.                        |
| `question` | `(prompt: string) => Promise<string>` | Prompts the user for input and returns their response. |
| `close`    | `() => Promise<void>`                 | Closes the interface and releases resources.           |

## Types

- [createReadlineInterfaceArgs](#createreadlineinterfaceargs)

### createReadlineInterfaceArgs

Arguments for creating a readline-based user interface.

| Type                          | Type                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createReadlineInterfaceArgs` | `{ /** Input stream (typically process.stdin). */ stdin: NodeJS.ReadableStream; /** Output stream (typically process.stdout). */ stdout: NodeJS.WritableStream; }` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/payment-evm](https://www.npmjs.com/package/@faremeter/payment-evm) - EVM payment handler
- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client fetch wrapper

## License

LGPL-3.0-only
