# Faremeter Code Conventions

This document describes the coding conventions, patterns, and best practices used in the Faremeter codebase. Follow these guidelines when contributing to ensure consistency across the project.

## Table of Contents

- [Build and Development Commands](#build-and-development-commands)
- [Quick Reference](#quick-reference)
- [Philosophy](#philosophy)
- [TypeScript Configuration](#typescript-configuration)
- [Code Formatting](#code-formatting)
- [Naming Conventions](#naming-conventions)
- [Type System Patterns](#type-system-patterns)
- [Import/Export Patterns](#importexport-patterns)
- [Error Handling](#error-handling)
- [Async Patterns](#async-patterns)
- [Module Organization](#module-organization)
- [Testing](#testing)
- [Logging](#logging)
- [Documentation](#documentation)

---

## Build and Development Commands

```bash
# Full build pipeline
make

# Individual commands
make build    # Compile TypeScript
make lint     # Run Prettier + ESLint checks
make test     # Run tap tests
make format   # Auto-format with Prettier
make doc      # Generate README from TSDoc
make clean    # Remove dist directories
```

See [DEV.md](./DEV.md) for complete development setup instructions.

---

## Quick Reference

### Do

- Always do a full build using `make` before considering your changes are correct/committing
- Use `arktype` for runtime validation
- Use `import type` for type-only imports
- Create factory functions with `create*` prefix
- Return `null` from handlers when request doesn't match
- Use `{ cause }` when re-throwing errors
- Use the package logger, never `console`
- Co-locate tests with source files
- Run `make format` before committing
- Let TypeScript infer types when obvious

### Don't

- Mix refactors/whitespace changes with functional changes.
- Use `console.log` (use logger)
- Use default exports
- Create classes unless necessary (prefer factory functions)
- Ignore validation errors (always check with `isValidationError`)
- Use `any` type (use `unknown` and narrow)
- Commit without running `make lint`
- Over-type code with explicit annotations the compiler can infer

---

## Philosophy

The codebase follows these core principles (from [ARCHITECTURE.md](./ARCHITECTURE.md)):

- **Composability** - Components work together flexibly
- **Extensibility** - Easy to add new payment schemes and wallets
- **Standards Agnostic** - Support multiple payment standards (x402, L402, etc.)
- **Pragmatic** - Interface-driven design with loose coupling

Key design decisions:

- Prefer interfaces over concrete implementations
- Use plugins for payment handlers and wallet adapters
- Minimize dependencies between packages
- Enable developers to import only what they need

---

## TypeScript Configuration

The project uses strict TypeScript settings defined in [`tsconfig.base.json`](./tsconfig.base.json). Key implications:

- **Strict mode enabled**: All strict type-checking options are active
- **`noUncheckedIndexedAccess`**: Array/object index access may return `undefined`. Always check before using.
- **`exactOptionalPropertyTypes`**: Optional properties cannot be explicitly set to `undefined`.
- **`verbatimModuleSyntax`**: Use `import type` for type-only imports.
- **ESNext target**: Modern JavaScript features are available; no need for polyfills.

---

## Code Formatting

Formatting is enforced via Prettier. See [`.prettierrc.json`](./.prettierrc.json) for the configuration.

Key formatting rules:

- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Double quotes `"` for strings
- **Semicolons**: Required
- **Trailing commas**: Always (including function parameters)

Run `make format` to auto-format all files.

---

## Naming Conventions

### Files

| Type                | Convention                        | Example                                 |
| ------------------- | --------------------------------- | --------------------------------------- |
| Regular modules     | Lowercase, hyphens for multi-word | `token-payment.ts`, `server-express.ts` |
| Single-word modules | Lowercase                         | `solana.ts`, `common.ts`, `index.ts`    |
| Test files          | `{name}.test.ts`                  | `cache.test.ts`, `facilitator.test.ts`  |

### Functions

| Pattern     | Use Case                       | Example                                         |
| ----------- | ------------------------------ | ----------------------------------------------- |
| `camelCase` | All functions                  | `handleMiddlewareRequest`                       |
| `create*`   | Factory functions              | `createFacilitatorHandler`, `createLocalWallet` |
| `is*`       | Boolean predicates             | `isValidationError`, `isKnownCluster`           |
| `get*`      | Retrieval without side effects | `getTokenBalance`, `getSupported`               |
| `lookup*`   | Search/lookup operations       | `lookupKnownSPLToken`, `lookupX402Network`      |
| `generate*` | Builder/generator functions    | `generateMatcher`, `generateDomain`             |
| `handle*`   | Event/request handlers         | `handleSettle`, `handleVerify`                  |

### Variables

| Pattern                | Use Case                    | Example                                      |
| ---------------------- | --------------------------- | -------------------------------------------- |
| `camelCase`            | Regular variables           | `paymentRequiredResponse`, `recentBlockhash` |
| `SCREAMING_SNAKE_CASE` | Constants, environment vars | `X402_EXACT_SCHEME`, `PAYER_KEYPAIR_PATH`    |
| `_` prefix             | Unused parameters           | `_ctx`, `_unused`                            |

### Types and Interfaces

| Pattern           | Use Case                 | Example                                   |
| ----------------- | ------------------------ | ----------------------------------------- |
| `PascalCase`      | Interfaces, type aliases | `FacilitatorHandler`, `PaymentExecer`     |
| `lowercase`       | Protocol-specific types  | `x402PaymentRequirements`, `eip712Domain` |
| `*Args` / `*Opts` | Function arguments       | `CreatePaymentHandlerOpts`                |
| `*Response`       | API responses            | `x402SettleResponse`                      |
| `*Info`           | Data structures          | `ChainInfo`, `SPLTokenInfo`               |
| `*Handler`        | Handler interfaces       | `FacilitatorHandler`, `PaymentHandler`    |

---

## Type System Patterns

### Runtime Validation with arktype

Use `arktype` for runtime type validation. Define the validator and TypeScript type together:

```typescript
import { type } from "arktype";

// Define runtime validator
export const x402PaymentRequirements = type({
  scheme: "string",
  network: "string",
  maxAmountRequired: "string.numeric",
  resource: "string.url",
});

// Derive TypeScript type from validator
export type x402PaymentRequirements = typeof x402PaymentRequirements.infer;
```

### Type Guards

Create type guards using validation functions:

```typescript
import { isValidationError } from "@faremeter/types";

export function isAddress(maybe: unknown): maybe is Address {
  return !isValidationError(Address(maybe));
}

export function isKnownCluster(c: string): c is KnownCluster {
  return knownClusters.includes(c as KnownCluster);
}
```

### Interfaces vs Types

- **`type`**: Use for data structures, unions, and arktype-derived types
- **`interface`**: Use for behavioral contracts (objects with methods)

```typescript
// Type for data structure
export type RequestContext = {
  request: RequestInfo | URL;
};

// Interface for behavioral contract
export interface FacilitatorHandler {
  getSupported?: () => Promise<x402SupportedKind>[];
  getRequirements: (
    req: x402PaymentRequirements[],
  ) => Promise<x402PaymentRequirements[]>;
  handleSettle: (requirements, payment) => Promise<x402SettleResponse | null>;
}
```

### Const Assertions for Exhaustive Types

Use `as const` for exhaustive literal types:

```typescript
const PaymentMode = {
  ToSpec: "toSpec",
  SettlementAccount: "settlementAccount",
} as const;

type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

// Usage in switch (TypeScript ensures all cases handled)
switch (mode) {
  case PaymentMode.ToSpec:
    // ...
    break;
  case PaymentMode.SettlementAccount:
    // ...
    break;
}
```

### Type-Only Imports

Use `import type` for type-only imports (required by `verbatimModuleSyntax`):

```typescript
import type { x402PaymentRequirements } from "@faremeter/types/x402";
import type { Hex, Account } from "viem";

// Mixed imports
import {
  type Rpc,
  type Transaction,
  createTransactionMessage, // value import
} from "@solana/kit";
```

### Avoid Over-Typing

Let TypeScript infer types when they are obvious. Do not add explicit type annotations that the compiler can easily infer. This keeps the code cleaner and reduces maintenance burden.

```typescript
// Good - return type is obvious from the implementation
const createHandler = async (network: string) => {
  const config = { network, enabled: true };
  return {
    getConfig: () => config,
    isEnabled: () => config.enabled,
  };
};

// Unnecessary - the return type is obvious
const createHandler = async (
  network: string,
): Promise<{
  getConfig: () => { network: string; enabled: boolean };
  isEnabled: () => boolean;
}> => {
  const config = { network, enabled: true };
  return {
    getConfig: () => config,
    isEnabled: () => config.enabled,
  };
};
```

**When to add explicit types:**

- Public API boundaries where the type serves as documentation
- When the inferred type would be too wide (e.g., `string` instead of a literal)
- When TypeScript cannot infer the type correctly
- Complex return types that benefit from explicit documentation

```typescript
// Good - explicit return type for public API clarity
export const createFacilitatorHandler = async (
  network: string,
  rpc: Rpc<SolanaRpcApi>,
): Promise<FacilitatorHandler> => { ... };

// Good - explicit type to narrow inference
const status: "pending" | "complete" = getStatus();

// Good - TypeScript needs help with the type
const items: Map<string, PaymentInfo> = new Map();
```

**When NOT to add explicit types:**

- Variable assignments with obvious literal values
- Return types that match a simple expression
- Loop variables and intermediate calculations
- Arrow function parameters in callbacks where context provides types

```typescript
// Unnecessary explicit types - let inference work
const count: number = 0; // Just use: const count = 0;
const name: string = "facilitator"; // Just use: const name = "facilitator";
const isValid: boolean = checkValid(); // Just use: const isValid = checkValid();
const items: string[] = ["a", "b", "c"]; // Just use: const items = ["a", "b", "c"];

// Let callback parameter types be inferred from context
handlers.map((h: Handler) => h.name); // Just use: handlers.map((h) => h.name);
```

---

## Import/Export Patterns

### Barrel Exports

Use `index.ts` files to re-export from modules:

```typescript
// packages/types/src/index.ts

// Namespaced exports for grouped functionality
export * as x402 from "./x402";
export * as client from "./client";
export * as solana from "./solana";

// Flat exports for utilities
export * from "./validation";
export * from "./literal";
```

### Named Exports (Preferred)

Prefer named exports over default exports:

```typescript
// Good
export function createMiddleware(args: CreateMiddlewareArgs) { ... }
export const X402_EXACT_SCHEME = "exact";

// Avoid
export default function createMiddleware(args: CreateMiddlewareArgs) { ... }
```

### Import Ordering

Order imports by category:

1. External library imports
2. Internal package imports (`@faremeter/*`)
3. Relative imports

```typescript
// External libraries
import { type } from "arktype";
import { Hono } from "hono";

// Internal packages
import { isValidationError } from "@faremeter/types";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import { lookupX402Network } from "@faremeter/info/solana";

// Relative imports
import { isValidTransaction } from "./verify";
import { logger } from "./logger";
```

---

## Error Handling

### Validation Errors

Check arktype validation errors before proceeding:

```typescript
const paymentPayload = x402PaymentHeaderToPayload(paymentHeader);

if (isValidationError(paymentPayload)) {
  logger.debug(`couldn't validate client payload: ${paymentPayload.summary}`);
  return sendPaymentRequired();
}

// paymentPayload is now typed correctly
```

### Local Error Response Factories

Create local helpers for consistent error responses:

```typescript
const handleSettle = async (requirements, payment) => {
  const errorResponse = (msg: string): x402SettleResponse => {
    logger.error(msg);
    return {
      success: false,
      error: msg,
      txHash: null,
      networkId: null,
    };
  };

  if (someConditionFails) {
    return errorResponse("Invalid transaction");
  }
  // ...
};
```

### Error Chaining

Use `{ cause }` when re-throwing errors to preserve the error chain:

```typescript
try {
  transaction = paymentPayload.transaction;
} catch (cause) {
  throw new Error("Failed to get compiled transaction message", { cause });
}
```

### Return `null` for "Not My Responsibility"

Handlers should return `null` when a request doesn't match their criteria:

```typescript
const handleVerify = async (requirements, payment) => {
  if (!isMatchingRequirement(requirements)) {
    return null; // Let another handler try
  }
  // Handle the request...
};
```

### Custom Error Classes

Create custom errors for specific failure modes:

```typescript
export class WrappedFetchError extends Error {
  constructor(
    message: string,
    public response: Response,
  ) {
    super(message);
  }
}
```

---

## Async Patterns

### Factory Functions

Use async factory functions that return objects with async methods:

```typescript
export const createFacilitatorHandler = async (
  network: string,
  rpc: Rpc<SolanaRpcApi>,
  feePayerKeypair: Keypair,
  mint: PublicKey,
  config?: FacilitatorOptions,
): Promise<FacilitatorHandler> => {
  // Async initialization
  const mintInfo = await fetchMint(rpc, address(mint.toBase58()));

  // Return object with async methods
  return {
    getSupported,
    getRequirements,
    handleVerify,
    handleSettle,
  };
};
```

### Parallel Execution

Use `Promise.all` for independent parallel operations:

```typescript
const [tokenName, tokenVersion] = await Promise.all([
  publicClient.readContract({ ...functionName: "name" }),
  publicClient.readContract({ ...functionName: "version" }),
]);
```

### Timeouts

Use `Promise.race` for operations that need timeouts:

```typescript
export function timeout<T>(timeoutMs: number, msg?: string) {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(msg ?? "timed out")), timeoutMs),
  );
}

export function allSettledWithTimeout<T>(
  promises: readonly Promise<T>[],
  timeoutMs: number,
) {
  const timedPromises = promises.map((p) =>
    Promise.race([p, timeout<T>(timeoutMs, "request timed out")]),
  );
  return Promise.allSettled(timedPromises);
}
```

### Retry Logic

Implement retries with exponential backoff:

```typescript
let attempt = (options.retryCount ?? 2) + 1;
let backoff = options.initialRetryDelay ?? 100;
let response: Response;

do {
  response = await makeRequest();

  if (response.status !== 402) {
    return response;
  }

  await new Promise((resolve) => setTimeout(resolve, backoff));
  backoff *= 2;
} while (--attempt > 0);
```

### Sleep Utility

Use a simple sleep helper for delays:

```typescript
export function sleep<T>(sleepMs: number, value?: T): Promise<T | undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(value), sleepMs));
}
```

---

## Module Organization

### Package Structure

Each package follows this structure:

```
packages/<name>/
├── package.json         # Package metadata and exports
├── tsconfig.json        # Extends tsconfig.base.json
├── README.md            # Auto-generated API documentation
└── src/
    ├── index.ts         # Public exports (barrel file)
    ├── internal.ts      # Internal utilities (optional)
    ├── common.ts        # Shared logic
    ├── logger.ts        # Package-specific logger
    ├── *.test.ts        # Tests co-located with source
    └── <feature>/       # Feature-specific subdirectories
        ├── index.ts
        ├── client.ts    # Client-side handler
        ├── facilitator.ts # Server-side handler
        └── common.ts    # Shared between client/facilitator
```

### Client/Facilitator Separation

Payment schemes separate client and server concerns:

- `client.ts` - Client-side payment handling (signing, sending)
- `facilitator.ts` - Server-side payment handling (verification, settlement)
- `common.ts` - Shared utilities between both

### Multiple Entry Points

Use `exports` in `package.json` for multiple entry points. This allows consumers to import specific submodules (e.g., `@faremeter/middleware/hono` or `@faremeter/middleware/express`) rather than the entire package.

---

## Testing

### Framework: node-tap

Tests use the `tap` framework with `@tapjs/tsx` for TypeScript support.

### Test File Structure

```typescript
#!/usr/bin/env pnpm tsx

import t from "tap";

await t.test("descriptiveTestName", async (t) => {
  // Setup
  const cache = new AgedLRUCache<string, number>({
    capacity: 3,
    maxAge: 1000,
  });

  // Assertions
  t.equal(cache.size, 0);
  t.matchOnly(cache.get("key"), undefined);

  // Always end the test
  t.pass();
  t.end();
});
```

### Key Patterns

- Start test files with shebang: `#!/usr/bin/env pnpm tsx`
- Use `await t.test()` for async test suites
- Always call `t.end()` to complete tests
- Co-locate tests with source files (`*.test.ts`)

### Common Assertions

```typescript
// Equality
t.equal(actual, expected); // Strict equality
t.matchOnly(actual, expected); // Deep/partial matching
t.match(actual, pattern); // Pattern matching

// Boolean
t.ok(condition); // Truthy

// Async errors
await t.rejects(asyncFn, expectedError);

// Test markers
t.pass(); // Mark success
t.fail(); // Mark failure
t.bailout(); // Abort on critical failure
```

### Time-Based Testing

Inject time functions for deterministic time-based tests:

```typescript
let theTime = 0;
const now = () => theTime;

const cache = new AgedLRUCache<string, number>({
  capacity: 3,
  maxAge: 1000,
  now, // Inject time function
});

// Advance time manually
theTime += 500;
t.matchOnly(cache.get("key"), 42); // Still valid

theTime += 1000;
t.matchOnly(cache.get("key"), undefined); // Expired
```

### Mock Patterns

Use mock factories for controlled test responses:

```typescript
export function responseFeeder(
  responses: (MockFetchType | MockResponse)[],
): MockFetchType {
  return async (input, init?) => {
    const t = responses.shift();
    if (t === undefined) {
      throw new Error("out of responses to feed");
    }
    if (t instanceof Function) {
      return t(input, init);
    }
    return t;
  };
}
```

---

## Logging

The project uses `@faremeter/logs`, a configurable logging abstraction that provides a unified logging interface across all packages with pluggable backend support.

### Application Configuration

Configure logging once at application startup:

```typescript
// apps/<name>/src/index.ts
import { configureApp } from "@faremeter/logs";

// Use defaults (level="info", auto-resolved backend)
await configureApp();

// Or with custom configuration
await configureApp({
  level: "debug", // "trace" | "debug" | "info" | "warning" | "error" | "fatal"
});
```

The logging system auto-resolves to `LogtapeBackend` if `@logtape/logtape` is available (optional peer dependency), otherwise falls back to `ConsoleBackend`.

### Package Logger Setup

Each package creates its own logger in a dedicated `logger.ts` file:

```typescript
// packages/<name>/src/logger.ts
import { getLogger } from "@faremeter/logs";

export const logger = await getLogger(["faremeter", "<package-name>"]);
```

### Logger Naming Convention

Use hierarchical logger names starting with `"faremeter"`:

- `["faremeter", "middleware"]`
- `["faremeter", "payment-solana-exact"]`
- `["faremeter", "facilitator"]`
- `["faremeter", "wallet-ledger"]`

For sub-modules, extend the hierarchy:

```typescript
await getLogger(["faremeter", "module1", "submodule"]);
```

### Usage

```typescript
import { logger } from "./logger";

// Simple messages
logger.info("Server started");
logger.debug("Processing request");
logger.warning("Rate limit approaching");
logger.error("Failed to connect");
logger.fatal("Unrecoverable error");

// Structured data via context object (second argument)
logger.info("Request received", { requestId: "abc123", method: "POST" });
logger.error("Transaction failed", { txHash, error: error.message });
```

### Log Levels

| Level     | Use Case                                      |
| --------- | --------------------------------------------- |
| `trace`   | Very detailed diagnostic information          |
| `debug`   | Development information, detailed diagnostics |
| `info`    | General operational messages, status updates  |
| `warning` | Recoverable issues, degraded functionality    |
| `error`   | Failures that need attention                  |
| `fatal`   | Unrecoverable errors                          |

### No Console

ESLint enforces `no-console: error`. Always use the package logger instead of `console.log`.

---

## Documentation

### TSDoc Comments

Document public APIs with TSDoc:

```typescript
/**
 * Creates a facilitator handler for the exact payment scheme.
 *
 * @param network - The Solana network identifier (e.g., "devnet", "mainnet-beta")
 * @param rpc - Solana RPC client
 * @param feePayerKeypair - Keypair for paying transaction fees
 * @param mint - Token mint public key
 * @param config - Optional configuration options
 * @returns Promise resolving to a FacilitatorHandler
 */
export const createFacilitatorHandler = async (
  network: string,
  rpc: Rpc<SolanaRpcApi>,
  feePayerKeypair: Keypair,
  mint: PublicKey,
  config?: FacilitatorOptions,
): Promise<FacilitatorHandler> => { ... };
```

### README Generation

Package README files are auto-generated from TSDoc using `tsdoc-markdown`. Run `make doc` to regenerate.

### Inline Comments

Use sparingly, prefer self-documenting code. When needed:

```typescript
// XXX - Temporary workaround until upstream fix
// TODO - Refactor when we add support for X
// FIXME - Known issue with edge case Y
```

---

## ESLint Rules

ESLint is configured in [`eslint.config.ts`](./eslint.config.ts) using TypeScript-ESLint's strict and stylistic rules.

Key rules and their implications:

- **No console**: `console.log` and similar are errors. Use the package logger instead.
- **Unused variables**: Must be prefixed with `_` (e.g., `_ctx`, `_unused`). This applies to function parameters, caught errors, and destructured values.
- **Type definitions**: Both `type` and `interface` are allowed. Choose based on the guidelines in [Interfaces vs Types](#interfaces-vs-types).

### Unused Variables

Prefix unused variables with `_`:

```typescript
// Good
const handleRequest = async (_ctx, requirements) => { ... };

// Bad - will error
const handleRequest = async (ctx, requirements) => { ... };  // ctx unused
```
