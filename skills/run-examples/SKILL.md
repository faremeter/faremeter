---
name: run-examples
description: Run the EVM and/or Solana example integration tests
argument-hint: "[evm|solana|all]"
disable-model-invocation: true
allowed-tools: Bash
---

# Run Example Integration Tests

Run the example integration tests from the `scripts/` directory. These are
live integration tests that start a facilitator, resource servers, and execute
real payment flows against testnets.

## Arguments

- `/run-examples evm` -- run only the EVM examples
- `/run-examples solana` -- run only the Solana examples
- `/run-examples all` or `/run-examples` (no argument) -- run both

Append `--flex` to also run the Solana flex example, which is skipped by
default because it adds ~60 seconds of mandatory wait per run for the
on-chain refund window (e.g. `/run-examples solana --flex`).

## Execution

Each suite is run via `pnpm tsx` from the `scripts/` directory with a generous
timeout (5 minutes for EVM, 10 minutes for Solana).

```bash
# EVM examples (Base Sepolia USDC payment via Express server)
pnpm tsx evm-example/run-examples.ts

# Solana examples (SOL, Squads, Token, Exact payments via Hono + Express servers)
pnpm tsx solana-example/run-examples.ts

# Solana examples including the flex example (adds ~60s for the refund window)
pnpm tsx solana-example/run-examples.ts --flex
```

The working directory MUST be `scripts/` (i.e., use workdir parameter).

## Interpreting results

- A successful run exits with code 0 and prints `{ msg: 'success' }` responses.
- A failed run exits non-zero and prints an error. Look for `WRN` or `ERR` log
  lines from the facilitator to diagnose.
- The facilitator logs settlement results including the on-chain transaction hash.

## What to run

Based on `$ARGUMENTS`:

- If the argument contains `evm`, run only the EVM examples.
- If the argument contains `solana`, run only the Solana examples.
- If the argument is `all`, empty, or omitted, run both sequentially (EVM first,
  then Solana).
- If the argument contains `--flex`, append `--flex` to the Solana
  invocation so the flex example is included.

Report a summary of results when done (which suites passed, how many payments
settled).
