# @faremeter/middleware-openapi

OpenAPI-driven pricing engine for evaluating payment amounts from `x-faremeter-*` spec extensions. Parses pricing rules from an OpenAPI spec, evaluates them against request and response data, and delegates payment to the configured facilitator. Payment-protocol agnostic -- works with any scheme that implements the facilitator interface.

See [OPENAPI-SPEC.md](./OPENAPI-SPEC.md) for the full specification of the `x-faremeter-pricing` extension.

## Installation

```bash
pnpm install @faremeter/middleware-openapi
```

## Features

- Declarative pricing - Rates, rules, and expressions defined in the OpenAPI spec
- JSONPath matching - Route requests to pricing rules via RFC 9535 with filter and selector support
- Authorize + capture - Hold an estimated amount before the upstream runs, settle the actual cost after
- Capture-only - Settle a fixed price before the upstream runs when no hold is needed
- Custom functions - `jsonSize()` for payload estimation, `coalesce()` for null-safe defaults
- Rate cascading - Document, path, and operation-level rate overrides with nearest-wins semantics
- Construction-time validation - Invalid expressions, bad JSONPath refs, and forbidden `$.response.*` references are caught at startup

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

| Function               | Type                                               |
| ---------------------- | -------------------------------------------------- |
| `createGatewayHandler` | `(config: GatewayHandlerConfig) => GatewayHandler` |

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

| Constant         | Type                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestContext` | `Type<{ operationKey: string; method: string; path: string; headers: Record<string, string or string[]>; query: Record<string, string or string[]>; body: Record<string, unknown> or null; }, {}>` |

### responseContext

| Constant          | Type                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `responseContext` | `Type<{ operationKey: string; method: string; path: string; headers: Record<string, string or string[]>; query: Record<string, string or string[]>; body: Record<string, unknown> or null; response: { ...; }; }, {}>` |

## Types

- [Asset](#asset)
- [Rates](#rates)
- [PricingRule](#pricingrule)
- [TransportType](#transporttype)
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
- [GatewayHandler](#gatewayhandler)

### Asset

| Type    | Type                                                                     |
| ------- | ------------------------------------------------------------------------ |
| `Asset` | `{ chain: string; token: string; decimals: number; recipient: string; }` |

### Rates

Per-asset pricing rates. Each value is the number of atomic asset units
charged per 1.0 of the rule's evaluated coefficient. Modelled as `bigint`
because atomic units flow directly to on-chain settlement and must not
lose precision to IEEE-754 rounding.

| Type    | Type                     |
| ------- | ------------------------ |
| `Rates` | `Record<string, bigint>` |

### PricingRule

| Type          | Type                                                      |
| ------------- | --------------------------------------------------------- |
| `PricingRule` | `{ match: string; authorize?: string; capture: string; }` |

### TransportType

| Type            | Type                           |
| --------------- | ------------------------------ |
| `TransportType` | `json" or "sse" or "websocket` |

### OperationPricing

| Type               | Type                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `OperationPricing` | `{ method: string; path: string; transport: TransportType; rates?: Rates; rules?: PricingRule[] or undefined; }` |

### FaremeterSpec

| Type            | Type                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| `FaremeterSpec` | `{ assets: Record<string, Asset>; operations: Record<string, OperationPricing>; }` |

### EvalContext

| Type          | Type                                                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EvalContext` | `{ request: { body: Record<string, unknown>; headers: Record<string, string>; query: Record<string, string>; path: string; }; response?: { body: Record<string, unknown>; headers: Record<string, string>; status: number; }; }` |

### PriceResult

| Type          | Type                                                                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PriceResult` | `{ matched: boolean; amount: Record<string, bigint>; // True when the matched rule has an explicit `authorize`// expression. When false, the authorize result was derived from // the`capture` expression and the handler settles at /request // instead of deferring to /response. hasAuthorize?: boolean; }` |

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

| Type                   | Type                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GatewayHandlerConfig` | `{ spec: FaremeterSpec; baseURL: string; x402Handlers?: FacilitatorHandler[]; mppMethodHandlers?: MPPMethodHandler[]; supportedVersions?: SupportedVersionsConfig; }` |

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

| Type              | Type                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CaptureResponse` | `{ captured: boolean; settled: boolean; amount: Record<string, string>; // When settlement is attempted and fails, the facilitator's // machine-readable error payload is propagated here. Absent for // successful settlements and for one-phase rules where authorize // and capture produce the same amount. error?: unknown; }` |

### GatewayHandler

| Type             | Type                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GatewayHandler` | `{ handleRequest(ctx: RequestContext): Promise<GatewayResponse>; handleResponse(ctx: ResponseContext): Promise<CaptureResponse>; }` |

<!-- TSDOC_END -->
