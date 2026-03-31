# @faremeter/middleware-openapi

OpenAPI-driven pricing engine for evaluating payment amounts from `x-faremeter-*` spec extensions.

## Installation

```bash
pnpm install @faremeter/middleware-openapi
```

## Features

- Declarative pricing - Define rates and rules in OpenAPI specs
- JSONPath matching - Route requests to pricing rules via RFC 9535
- Two-phase pricing - Authorize holds before requests, capture actual cost after
- Custom functions - `jsonSize()` for payload estimation, `coalesce()` for defaults
- Rate cascading - Document, path, and operation-level rate overrides

## API Reference

<!-- TSDOC_START -->

## Functions

- [buildContext](#buildcontext)
- [withResponse](#withresponse)
- [createPricingEvaluator](#createpricingevaluator)
- [createGatewayHandler](#creategatewayhandler)
- [loadSpec](#loadspec)
- [extractSpec](#extractspec)

### buildContext

Build an evaluation context from HTTP request data.

| Function       | Type                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildContext` | `(opts: { body: Record<string, unknown>; headers: Record<string, string>; query?: Record<string, string> or undefined; path: string; }) => EvalContext` |

### withResponse

Augment an evaluation context with HTTP response data for capture phase.

| Function       | Type                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `withResponse` | `(ctx: EvalContext, response: { body: Record<string, unknown>; headers: Record<string, string>; status: number; }) => EvalContext` |

### createPricingEvaluator

Evaluates pricing rules from an OpenAPI spec against request/response context.

| Function                 | Type                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `createPricingEvaluator` | `(spec: FaremeterSpec, opts?: { onError?: EvalErrorHandler or undefined; } or undefined) => PricingEvaluator` |

Parameters:

- `spec`: - Parsed faremeter spec with assets, operations, and rates
- `opts`: - Optional configuration including error handler

### createGatewayHandler

| Function               | Type                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createGatewayHandler` | `(config: GatewayHandlerConfig) => { handleRequest: (ctx: { operationKey: string; method: string; path: string; headers: Record<string, string>; query: Record<string, string>; body: Record<...> or null; }) => Promise<...>; handleResponse: (ctx: { ...; }) => Promise<...>; }` |

### loadSpec

Load and parse an OpenAPI spec file, extracting x-faremeter pricing extensions.

| Function   | Type                                           |
| ---------- | ---------------------------------------------- |
| `loadSpec` | `(filePath: string) => Promise<FaremeterSpec>` |

Parameters:

- `filePath`: - Path to the OpenAPI YAML or JSON file

### extractSpec

Extract x-faremeter pricing extensions from a dereferenced OpenAPI document.

| Function      | Type                                              |
| ------------- | ------------------------------------------------- |
| `extractSpec` | `(doc: Record<string, unknown>) => FaremeterSpec` |

Parameters:

- `doc`: - Dereferenced OpenAPI document as a plain object

## Constants

- [requestContext](#requestcontext)
- [responseContext](#responsecontext)

### requestContext

| Constant         | Type                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestContext` | `Type<{ operationKey: string; method: string; path: string; headers: Record<string, string>; query: Record<string, string>; body: Record<string, unknown> or null; }, {}>` |

### responseContext

| Constant          | Type                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `responseContext` | `Type<{ operationKey: string; method: string; path: string; headers: Record<string, string>; query: Record<string, string>; body: Record<string, unknown> or null; response: { ...; }; }, {}>` |

## Types

- [Asset](#asset)
- [Rates](#rates)
- [PricingRule](#pricingrule)
- [OperationPricing](#operationpricing)
- [FaremeterSpec](#faremeterspec)
- [EvalContext](#evalcontext)
- [PriceResult](#priceresult)
- [EvalError](#evalerror)
- [EvalErrorHandler](#evalerrorhandler)
- [PricingEvaluator](#pricingevaluator)
- [GatewayHandlerConfig](#gatewayhandlerconfig)
- [RequestContext](#requestcontext)
- [ResponseContext](#responsecontext)
- [GatewayResponse](#gatewayresponse)
- [CaptureResponse](#captureresponse)

### Asset

| Type    | Type                                                                     |
| ------- | ------------------------------------------------------------------------ |
| `Asset` | `{ chain: string; token: string; decimals: number; recipient: string; }` |

### Rates

| Type    | Type                     |
| ------- | ------------------------ |
| `Rates` | `Record<string, number>` |

### PricingRule

| Type          | Type                                                      |
| ------------- | --------------------------------------------------------- |
| `PricingRule` | `{ match: string; authorize?: string; capture: string; }` |

### OperationPricing

| Type               | Type                                                     |
| ------------------ | -------------------------------------------------------- |
| `OperationPricing` | `{ rates?: Rates; rules?: PricingRule[] or undefined; }` |

### FaremeterSpec

| Type            | Type                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| `FaremeterSpec` | `{ assets: Record<string, Asset>; operations: Record<string, OperationPricing>; }` |

### EvalContext

| Type          | Type                                                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EvalContext` | `{ request: { body: Record<string, unknown>; headers: Record<string, string>; query: Record<string, string>; path: string; }; response?: { body: Record<string, unknown>; headers: Record<string, string>; status: number; }; }` |

### PriceResult

| Type          | Type                                                    |
| ------------- | ------------------------------------------------------- |
| `PriceResult` | `{ matched: boolean; amount: Record<string, bigint>; }` |

### EvalError

| Type        | Type                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `EvalError` | `{ phase: "authorize" or "capture"; rule: PricingRule; error: unknown; }` |

### EvalErrorHandler

| Type               | Type                       |
| ------------------ | -------------------------- |
| `EvalErrorHandler` | `(err: EvalError) => void` |

### PricingEvaluator

| Type               | Type                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PricingEvaluator` | `{ authorize(operationKey: string, ctx: EvalContext): PriceResult; capture(operationKey: string, ctx: EvalContext): PriceResult; getAssets(): FaremeterSpec["assets"]; }` |

### GatewayHandlerConfig

| Type                   | Type                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GatewayHandlerConfig` | `{ spec: FaremeterSpec; baseURL?: string; x402Handlers?: FacilitatorHandler[]; mppMethodHandlers?: MPPMethodHandler[]; supportedVersions?: SupportedVersionsConfig; }` |

### RequestContext

| Type             | Type                          |
| ---------------- | ----------------------------- |
| `RequestContext` | `typeof requestContext.infer` |

### ResponseContext

| Type              | Type                           |
| ----------------- | ------------------------------ |
| `ResponseContext` | `typeof responseContext.infer` |

### GatewayResponse

| Type              | Type                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `GatewayResponse` | `{ status: number; headers?: Record<string, string>; body?: unknown; }` |

### CaptureResponse

| Type              | Type                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `CaptureResponse` | `{ captured: boolean; settled: boolean; amount: Record<string, string>; }` |

<!-- TSDOC_END -->
