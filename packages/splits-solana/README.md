# @faremeter/splits-solana

Cascade Splits integration for Solana payments. Enables automatic revenue sharing for x402-enabled APIs with a 1% protocol fee.

## Installation

```bash
pnpm install @faremeter/splits-solana
```

## Use Cases

### 1. Resource Server (API Provider)

Set up automatic revenue sharing for your x402-enabled API:

```typescript
import { ensureSplit } from "@faremeter/splits-solana";

// Create split: 70% to node operator, 30% to treasury
// (1% protocol fee taken automatically from distributions)
const result = await ensureSplit(rpc, signer, {
  label: "oracle-payouts",
  recipients: [
    { address: nodeOperator, share: 70 },
    { address: treasury, share: 30 },
  ],
});

if (result.status === "CREATED" || result.status === "NO_CHANGE") {
  // Use splitConfig as your x402 payTo (token-agnostic)
  const payTo = result.splitConfig;
  // Configure your resource server with this payTo address
}
```

### 2. Facilitator (Payment Processor)

After settling a payment, check and execute splits:

```typescript
import { isCascadeSplit, executeSplit } from "@faremeter/splits-solana";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// payTo from x402 header is the splitConfig address
// Derive vault: ATA(owner=payTo, mint) using @solana-program/token
const [vault] = await findAssociatedTokenPda({
  mint,
  owner: payTo,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});

if (await isCascadeSplit(rpc, vault)) {
  const result = await executeSplit(rpc, signer, {
    vault,
    minBalance: 1_000_000n, // Batch until 1 USDC
  });

  if (result.status === "EXECUTED") {
    console.log(`Split executed: ${result.signature}`);
  }
}
```

## Key Concept: payTo vs vault

| Address       | What                      | Use                           |
| ------------- | ------------------------- | ----------------------------- |
| `splitConfig` | PDA identifying the split | x402 `payTo` (token-agnostic) |
| `vault`       | ATA owned by splitConfig  | Where tokens land             |

Merchants provide `splitConfig` as payTo. Facilitators derive the vault using standard ATA derivation: `ATA(owner=payTo, mint)`.

## API

| Function           | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `ensureSplit()`    | Idempotent create/update split config     |
| `executeSplit()`   | Distribute vault balance to recipients    |
| `updateSplit()`    | Explicitly update recipients              |
| `closeSplit()`     | Close split and recover rent              |
| `getPayTo()`       | Derive splitConfig address for x402 payTo |
| `isCascadeSplit()` | Check if vault is a Cascade split         |

## Features

- HTTP-based (no WebSocket required)
- Idempotent operations
- Discriminated union results (never throws for business logic)
- Priority fee support for network congestion

## Related Packages

- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/types](https://www.npmjs.com/package/@faremeter/types) - Shared types
- [@cascade-fyi/splits-sdk](https://www.npmjs.com/package/@cascade-fyi/splits-sdk) - Cascade Splits SDK
- [Cascade Splits Protocol](https://github.com/cascade-protocol/splits) - Program source

## License

LGPL-3.0-only
