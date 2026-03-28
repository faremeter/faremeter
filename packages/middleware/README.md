# @faremeter/middleware

Server middleware for adding payment walls to API endpoints using the x402 protocol.

## Installation

```bash
pnpm install @faremeter/middleware
```

## Features

- Paywall any endpoint - Add `middleware` to any route
- Framework agnostic - Express, Hono, or custom
- Multi-chain support - Solana, EVM, extensible
- Fast validation - Payment requirements caching
- Facilitator integration - Handles settlement verification

## API Reference

<!-- TSDOC_START -->

## Functions

- [findMatchingPaymentRequirements](#findmatchingpaymentrequirements)
- [findMatchingPaymentRequirementsV2](#findmatchingpaymentrequirementsv2)
- [relaxedRequirementsToV2](#relaxedrequirementstov2)
- [resolveSupportedVersions](#resolvesupportedversions)
- [validateMiddlewareArgs](#validatemiddlewareargs)
- [deriveCapabilities](#derivecapabilities)
- [deriveResourceInfo](#deriveresourceinfo)
- [acceptsToPricing](#acceptstopricing)
- [resolveConfig](#resolveconfig)
- [handleMiddlewareRequest](#handlemiddlewarerequest)
- [createMiddleware](#createmiddleware)
- [createMiddleware](#createmiddleware)

### findMatchingPaymentRequirements

Finds the payment requirement that matches the client's v1 payment payload.

| Function                          | Type                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `findMatchingPaymentRequirements` | `(accepts: x402PaymentRequirementsV1[], payload: x402PaymentPayloadV1) => any` |

Parameters:

- `accepts`: - Array of accepted payment requirements from the facilitator
- `payload`: - The client's payment payload

Returns:

The matching requirement, or undefined if no match found

### findMatchingPaymentRequirementsV2

Finds the payment requirement that matches the client's v2 payment payload.

| Function                            | Type                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `findMatchingPaymentRequirementsV2` | `(accepts: x402PaymentRequirements[], payload: x402PaymentPayload) => any` |

Parameters:

- `accepts`: - Array of accepted payment requirements from the facilitator
- `payload`: - The client's v2 payment payload

Returns:

The matching requirement, or undefined if no match found

### relaxedRequirementsToV2

Converts v1 relaxed requirements to v2 format, preserving all fields
including `extra`.

| Function                  | Type                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `relaxedRequirementsToV2` | `(req: x402PaymentRequirementsV1) => x402PaymentRequirements` |

### resolveSupportedVersions

Resolve and validate supported versions config.
Returns resolved config with defaults applied.
Throws if configuration is invalid.

| Function                   | Type                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `resolveSupportedVersions` | `(config?: SupportedVersionsConfig or undefined) => Required<SupportedVersionsConfig>` |

### validateMiddlewareArgs

Validates that CommonMiddlewareArgs has exactly one configuration mode.

| Function                 | Type                                   |
| ------------------------ | -------------------------------------- |
| `validateMiddlewareArgs` | `(args: CommonMiddlewareArgs) => void` |

### deriveCapabilities

Derives `HandlerCapabilities` from relaxed v1 requirements.
Used by framework adapters to construct capabilities for the HTTP wrapper
from the legacy `accepts` configuration.

| Function             | Type                                                            |
| -------------------- | --------------------------------------------------------------- |
| `deriveCapabilities` | `(accepts: x402PaymentRequirementsV1[]) => HandlerCapabilities` |

### deriveResourceInfo

Extracts resource info from v1 accepts entries.
Used by framework adapters to build the resource info for the 402 response.

| Function             | Type                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| `deriveResourceInfo` | `(accepts: x402PaymentRequirementsV1[], resourceURL: string) => x402ResourceInfo` |

### acceptsToPricing

| Function           | Type                                                          |
| ------------------ | ------------------------------------------------------------- |
| `acceptsToPricing` | `(accepts: x402PaymentRequirementsV1[]) => ResourcePricing[]` |

### resolveConfig

Resolves {@link CommonMiddlewareArgs} into the handlers + pricing tuple
that {@link handleMiddlewareRequest} needs. For the `facilitatorURL` path,
creates an HTTP handler wrapper and converts accepts to pricing.

| Function        | Type                                             |
| --------------- | ------------------------------------------------ |
| `resolveConfig` | `(args: CommonMiddlewareArgs) => ResolvedConfig` |

### handleMiddlewareRequest

Core middleware request handler that processes x402 payment flows.

Delegates to the x402 glue layer for challenge generation, settlement,
and verification. The middleware itself is protocol-agnostic -- it
formats HTTP responses but never constructs x402 types directly.

| Function                  | Type                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `handleMiddlewareRequest` | `<MiddlewareResponse>(args: HandleMiddlewareRequestArgs<MiddlewareResponse>) => Promise<MiddlewareResponse or undefined>` |

### createMiddleware

Creates Express middleware that gates routes behind x402 payment.

| Function           | Type                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createMiddleware` | `(args: CommonMiddlewareArgs) => Promise<(req: Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>, res: Response<...>, next: NextFunction) => Promise<...>>` |

Parameters:

- `args`: - Configuration including handlers + pricing or facilitator URL

Returns:

An Express middleware function

### createMiddleware

Creates Hono middleware that gates routes behind x402 payment.

The middleware intercepts requests, checks for payment headers, communicates
with the facilitator to validate and settle payments, and only allows the
request to proceed if payment is successful.

| Function           | Type                                                         |
| ------------------ | ------------------------------------------------------------ |
| `createMiddleware` | `(args: CreateMiddlewareArgs) => Promise<MiddlewareHandler>` |

Parameters:

- `args`: - Configuration including handlers + pricing or facilitator URL

Returns:

A Hono middleware handler

## AgedLRUCache

An LRU cache with time-based expiration.

Entries are evicted when they exceed maxAge or when the cache reaches
capacity (least recently used entries are removed first).

### Methods

- [get](#get)
- [put](#put)

#### get

| Method | Type                         |
| ------ | ---------------------------- |
| `get`  | `(key: K) => V or undefined` |

#### put

| Method | Type                         |
| ------ | ---------------------------- |
| `put`  | `(key: K, value: V) => void` |

## Types

- [AgedLRUCacheOpts](#agedlrucacheopts)
- [RelaxedRequirements](#relaxedrequirements)
- [RelaxedRequirementsV2](#relaxedrequirementsv2)
- [SupportedVersionsConfig](#supportedversionsconfig)
- [CommonMiddlewareArgs](#commonmiddlewareargs)
- [ResolvedConfig](#resolvedconfig)
- [SettleResultV1](#settleresultv1)
- [SettleResultV2](#settleresultv2)
- [SettleResult](#settleresult)
- [VerifyResultV1](#verifyresultv1)
- [VerifyResultV2](#verifyresultv2)
- [VerifyResult](#verifyresult)
- [MiddlewareBodyContextV1](#middlewarebodycontextv1)
- [MiddlewareBodyContextV2](#middlewarebodycontextv2)
- [MiddlewareBodyContext](#middlewarebodycontext)
- [HandleMiddlewareRequestArgs](#handlemiddlewarerequestargs)

### AgedLRUCacheOpts

Configuration options for the AgedLRUCache.

| Type               | Type                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AgedLRUCacheOpts` | `{ /** Maximum number of entries. Defaults to 256. */ capacity?: number; /** Maximum age in milliseconds before entries expire. Defaults to 30000. */ maxAge?: number; /** Custom time function for testing. Defaults to Date.now. */ now?: () => number; }` |

### RelaxedRequirements

| Type                  | Type                                 |
| --------------------- | ------------------------------------ |
| `RelaxedRequirements` | `Partial<x402PaymentRequirementsV1>` |

### RelaxedRequirementsV2

| Type                    | Type                               |
| ----------------------- | ---------------------------------- |
| `RelaxedRequirementsV2` | `Partial<x402PaymentRequirements>` |

### SupportedVersionsConfig

Configuration for which x402 protocol versions the middleware supports.
At least one version must be enabled.

| Type                      | Type                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SupportedVersionsConfig` | `{ /** Support x402 v1 protocol (JSON body responses, X-PAYMENT header). Default: true */ x402v1?: boolean; /** Support x402 v2 protocol (PAYMENT-REQUIRED header, PAYMENT-SIGNATURE header). Default: false */ x402v2?: boolean; }` |

### CommonMiddlewareArgs

Common configuration arguments shared by all middleware implementations.
Supports two mutually exclusive modes: in-process handlers or remote facilitator.

| Type                   | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommonMiddlewareArgs` | `{ /** x402 handlers for in-process settlement. */ x402Handlers?: FacilitatorHandler[]; /** Protocol-agnostic pricing for in-process handlers. */ pricing?: ResourcePricing[];  /** URL of a remote facilitator service (backward compat). */ facilitatorURL?: string; /** Payment requirements for the remote facilitator path. */ accepts?: (RelaxedRequirements or RelaxedRequirements[])[]; /** Cache configuration for remote facilitator responses. */ cacheConfig?: AgedLRUCacheOpts and { disable?: boolean };  /** Which x402 protocol versions to support. */ supportedVersions?: SupportedVersionsConfig; }` |

### ResolvedConfig

| Type             | Type                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `ResolvedConfig` | `{ handlers: FacilitatorHandler[]; pricing: ResourcePricing[]; resourceInfo?: x402ResourceInfo; }` |

### SettleResultV1

| Type             | Type |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `SettleResultV1` | `    | { success: true; facilitatorResponse: x402SettleResponseV1 } or { success: false; errorResponse: MiddlewareResponse }` |

### SettleResultV2

| Type             | Type |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `SettleResultV2` | `    | { success: true; facilitatorResponse: x402SettleResponse } or { success: false; errorResponse: MiddlewareResponse }` |

### SettleResult

| Type           | Type |
| -------------- | ---- | ------------------------------------------------------------------------- |
| `SettleResult` | `    | SettleResultV1<MiddlewareResponse> or SettleResultV2<MiddlewareResponse>` |

### VerifyResultV1

| Type             | Type |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `VerifyResultV1` | `    | { success: true; facilitatorResponse: x402VerifyResponseV1 } or { success: false; errorResponse: MiddlewareResponse }` |

### VerifyResultV2

| Type             | Type |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `VerifyResultV2` | `    | { success: true; facilitatorResponse: x402VerifyResponse } or { success: false; errorResponse: MiddlewareResponse }` |

### VerifyResult

| Type           | Type |
| -------------- | ---- | ------------------------------------------------------------------------- |
| `VerifyResult` | `    | VerifyResultV1<MiddlewareResponse> or VerifyResultV2<MiddlewareResponse>` |

### MiddlewareBodyContextV1

Context provided to the middleware body handler for v1 protocol requests.
Contains payment information and functions to verify or settle the payment.

| Type                      | Type                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MiddlewareBodyContextV1` | `{ protocolVersion: 1; paymentRequirements: x402PaymentRequirementsV1; paymentPayload: x402PaymentPayloadV1; settle: () => Promise<SettleResultV1<MiddlewareResponse>>; verify: () => Promise<VerifyResultV1<MiddlewareResponse>>; }` |

### MiddlewareBodyContextV2

Context provided to the middleware body handler for v2 protocol requests.
Contains payment information and functions to verify or settle the payment.

| Type                      | Type                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MiddlewareBodyContextV2` | `{ protocolVersion: 2; paymentRequirements: x402PaymentRequirements; paymentPayload: x402PaymentPayload; settle: () => Promise<SettleResultV2<MiddlewareResponse>>; verify: () => Promise<VerifyResultV2<MiddlewareResponse>>; }` |

### MiddlewareBodyContext

Context provided to the middleware body handler.
Use protocolVersion to discriminate between v1 and v2 request types.

| Type                    | Type |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `MiddlewareBodyContext` | `    | MiddlewareBodyContextV1<MiddlewareResponse> or MiddlewareBodyContextV2<MiddlewareResponse>` |

### HandleMiddlewareRequestArgs

Arguments for the core middleware request handler.
Framework-specific middleware implementations adapt their request/response
objects to this interface.

| Type                          | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HandleMiddlewareRequestArgs` | `{ /** x402 handlers for in-process settlement. */ x402Handlers: FacilitatorHandler[]; /** Protocol-agnostic pricing entries for the current request. */ pricing: ResourcePricing[]; /** The resource URL being accessed. */ resource: string; /** Resolved supported versions configuration. */ supportedVersions: Required<SupportedVersionsConfig>; /** Function to retrieve a request header value. */ getHeader: (key: string) => string or undefined; /** Function to send a JSON response with optional headers. */ sendJSONResponse: ( status: PossibleStatusCodes, body?: PossibleJSONResponse, headers?: Record<string, string>, ) => MiddlewareResponse; /** Handler function called when a valid payment is received. */ body: ( context: MiddlewareBodyContext<MiddlewareResponse>, ) => Promise<MiddlewareResponse or undefined>; /** Optional function to set a response header. */ setResponseHeader?: (key: string, value: string) => void; /** Optional pre-built resource info for the 402 response. */ resourceInfo?: x402ResourceInfo; }` |

<!-- TSDOC_END -->

## Examples

See working examples in the [faremeter repository](https://github.com/faremeter/faremeter/tree/main/scripts):

- [Express + Solana](https://github.com/faremeter/faremeter/blob/main/scripts/solana-example/server-express.ts)
- [Express + EVM](https://github.com/faremeter/faremeter/blob/main/scripts/evm-example/server-express.ts)
- [Hono + Solana](https://github.com/faremeter/faremeter/blob/main/scripts/solana-example/server-hono.ts)

## Related Packages

- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client-side fetch wrapper
- [@faremeter/info](https://www.npmjs.com/package/@faremeter/info) - Network/asset configuration helpers
- [@faremeter/facilitator](https://www.npmjs.com/package/@faremeter/facilitator) - Payment facilitator service

## License

LGPL-3.0-only
