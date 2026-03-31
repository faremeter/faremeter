# @faremeter/fetch

HTTP fetch wrapper that automatically handles 402 Payment Required responses with the x402 protocol.

## Installation

```bash
pnpm install @faremeter/fetch
```

## Features

- Automatic 402 handling - Transparently pays and retries
- Pluggable payment handlers - Support any blockchain
- Multi-chain support - Use multiple handlers simultaneously
- Smart payer selection - Choose based on balance, cost, etc.
- Retry logic - Configurable exponential backoff
- Type-safe - Full TypeScript support

## API Reference

<!-- TSDOC_START -->

## Functions

- [chooseFirstAvailable](#choosefirstavailable)
- [processPaymentRequiredResponse](#processpaymentrequiredresponse)
- [processPaymentRequiredResponseMPP](#processpaymentrequiredresponsempp)
- [wrap](#wrap)
- [responseFeeder](#responsefeeder)

### chooseFirstAvailable

Default payer chooser that selects the first available payment execer.

| Function               | Type                                                 |
| ---------------------- | ---------------------------------------------------- |
| `chooseFirstAvailable` | `(possiblePayers: PaymentExecer[]) => PaymentExecer` |

Parameters:

- `possiblePayers`: - Array of payment execers that can handle the requirements

Returns:

The first execer in the array

### processPaymentRequiredResponse

Process a 402 Payment Required response, auto-detecting v1 or v2 protocol.

| Function                         | Type                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `processPaymentRequiredResponse` | `(ctx: RequestContext, response: Response, options: ProcessPaymentRequiredResponseOpts) => Promise<ProcessPaymentRequiredResponseResult>` |

Parameters:

- `ctx`: - Request context
- `response`: - The 402 Response object (must not have been consumed)
- `options`: - Processing options including payment handlers

Returns:

Payment information including header and detected version

### processPaymentRequiredResponseMPP

| Function                            | Type                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `processPaymentRequiredResponseMPP` | `(response: Response, handlers: MPPPaymentHandler[], opts?: ProcessMPPOpts or undefined) => Promise<string or undefined>` |

### wrap

Wraps a fetch function with automatic x402 payment handling.

When a 402 Payment Required response is received, the wrapper automatically
processes the payment requirements, executes payment via the configured handlers,
and retries the request with the payment header attached.

| Function | Type                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wrap`   | `(phase2Fetch: (input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<Response>, options: WrapOpts) => (input: RequestInfo or URL, init?: RequestInit) => Promise<...>` |

Parameters:

- `phase2Fetch`: - The fetch function to use for the paid request (phase 2)
- `options`: - Configuration including payment handlers and retry settings

Returns:

A wrapped fetch function with the same signature as native fetch

### responseFeeder

Creates a mock fetch that returns responses from a queue in order.

Each call to the returned fetch function shifts the next response from the array.
Responses can be either Response objects or fetch functions for dynamic behavior.

| Function         | Type                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `responseFeeder` | `(responses: (Response or ((input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<Response>))[]) => (input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<...>` |

Parameters:

- `responses`: - Array of responses or fetch functions to return in order

Returns:

A fetch function that serves responses from the queue

## WrappedFetchError

Error thrown when payment fails after exhausting all retry attempts.
Contains the final 402 response for inspection.

## Types

- [DetectedVersion](#detectedversion)
- [ProcessPaymentRequiredResponseOpts](#processpaymentrequiredresponseopts)
- [ProcessPaymentRequiredResponseResult](#processpaymentrequiredresponseresult)
- [ProcessMPPOpts](#processmppopts)
- [WrapOpts](#wrapopts)
- [MockFetchType](#mockfetchtype)
- [MockResponse](#mockresponse)

### DetectedVersion

| Type              | Type     |
| ----------------- | -------- |
| `DetectedVersion` | `1 or 2` |

### ProcessPaymentRequiredResponseOpts

Options for processing a 402 Payment Required response.

| Type                                 | Type                                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProcessPaymentRequiredResponseOpts` | `{ /** Payment handlers that produce execers for payment requirements. */ handlers: PaymentHandler[]; /** Optional function to select among multiple possible payers. Defaults to chooseFirstAvailable. */ payerChooser?: (execer: PaymentExecer[]) => Promise<PaymentExecer>; }` |

### ProcessPaymentRequiredResponseResult

Result of processing a 402 Payment Required response.

| Type                                   | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProcessPaymentRequiredResponseResult` | `{ /** The selected payment execer. */ payer: PaymentExecer; /** The result from executing the payment. */ payerResult: { payload: object }; /** The payment payload in the detected protocol version format. */ paymentPayload: x402PaymentPayload or x402PaymentPayloadV1; /** Base64-encoded payment header ready to attach to the retry request. */ paymentHeader: string; /** The detected protocol version (1 or 2). */ detectedVersion: DetectedVersion; }` |

### ProcessMPPOpts

Attempts to process a 402 response as an MPP challenge.

Checks for a WWW-Authenticate header with Payment challenges, then
iterates handlers to find one that matches. Returns the Authorization
header value on success, or undefined if no MPP challenges are present
or no handler matches (allowing fallthrough to x402).

Does not consume the response body.

| Type             | Type                       |
| ---------------- | -------------------------- |
| `ProcessMPPOpts` | `{ bodyDigest?: string; }` |

### WrapOpts

Configuration options for wrapping a fetch function with x402 payment handling.

| Type       | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WrapOpts` | `ProcessPaymentRequiredResponseOpts and { /** MPP payment handlers for Authorization: Payment flow. */ mppHandlers?: MPPPaymentHandler[]; /** Optional fetch function for the initial request (phase 1). Defaults to phase2Fetch. */ phase1Fetch?: typeof fetch; /** Number of retry attempts after initial failure. Defaults to 2. */ retryCount?: number; /** Initial delay between retries in milliseconds. Doubles after each attempt. Defaults to 100. */ initialRetryDelay?: number; /** If true, returns the 402 response instead of throwing on payment failure. */ returnPaymentFailure?: boolean; }` |

### MockFetchType

| Type            | Type           |
| --------------- | -------------- |
| `MockFetchType` | `typeof fetch` |

### MockResponse

| Type           | Type       |
| -------------- | ---------- |
| `MockResponse` | `Response` |

<!-- TSDOC_END -->

## Examples

See working examples in the [faremeter repository](https://github.com/faremeter/faremeter/tree/main/scripts):

- [Solana payment example](https://github.com/faremeter/faremeter/blob/main/scripts/solana-example/sol-payment.ts)
- [EVM payment example](https://github.com/faremeter/faremeter/blob/main/scripts/evm-example/base-sepolia-payment.ts)

## Related Packages

- [@faremeter/rides](https://www.npmjs.com/package/@faremeter/rides) - High-level SDK
- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/payment-evm](https://www.npmjs.com/package/@faremeter/payment-evm) - EVM payment handler
- [@faremeter/middleware](https://www.npmjs.com/package/@faremeter/middleware) - Server-side middleware

## License

LGPL-3.0-only
