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
- [PhaseTrace](#phasetrace)
- [EvalTrace](#evaltrace)
- [PriceResult](#priceresult)
- [EvalError](#evalerror)
- [EvalErrorHandler](#evalerrorhandler)
- [PricingEvaluator](#pricingevaluator)
- [GatewayHandlerConfig](#gatewayhandlerconfig)
- [AuthorizeResponse](#authorizeresponse)
- [SettledPayment](#settledpayment)
- [RequestContext](#requestcontext)
- [ResponseContext](#responsecontext)
- [GatewayRequestResult](#gatewayrequestresult)
- [GatewayResponseResult](#gatewayresponseresult)
- [CapturePhase](#capturephase)
- [CaptureError](#captureerror)
- [CaptureRequestInfo](#capturerequestinfo)
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

### PhaseTrace

| Type         | Type                                                          |
| ------------ | ------------------------------------------------------------- |
| `PhaseTrace` | `{ bindings: Record<string, unknown>; coefficient: number; }` |

### EvalTrace

| Type        | Type                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `EvalTrace` | `{ ruleIndex: number; rule: PricingRule; authorize?: PhaseTrace; capture: PhaseTrace; }` |

### PriceResult

| Type          | Type                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PriceResult` | `{ matched: boolean; amount: Record<string, bigint>; // True when the matched rule has an explicit `authorize`// expression. When false, the authorize result was derived from // the`capture` expression and the handler settles at /request // instead of deferring to /response. hasAuthorize?: boolean; ruleIndex?: number; rule?: PricingRule; trace?: PhaseTrace; }` |

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

| Type                   | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GatewayHandlerConfig` | `{ spec: FaremeterSpec; baseURL: string; x402Handlers?: FacilitatorHandler[]; mppMethodHandlers?: MPPMethodHandler[]; supportedVersions?: SupportedVersionsConfig; /** * Called post-settlement when a pricing rule matched and produced * a non-empty capture amount. `result.phase`indicates whether * settlement happened at`/request`(one-phase) or`/response`* (two-phase). * * For two-phase rules the hook fires at`/response` when settlement * is attempted, regardless of whether it succeeded or failed * (`result.settled`and`result.error`distinguish the outcome). * For one-phase rules the hook fires at`/request` only on * successful settlement -- if the facilitator rejects the payment, * the request gets a 402 and the hook is not invoked. * * The hook does NOT fire when the capture expression evaluates to * zero across all assets. A zero-amount capture produces no * settlement and no hook invocation. * * The hook is awaited -- a slow async hook delays the caller. The * return value is computed before the hook is invoked, so a throw * or rejected promise is caught and logged without affecting it. * * Requires payment handlers (`x402Handlers`or`mppMethodHandlers`) * to be configured. Without them no settlement occurs and this * hook is never invoked. */ onCapture?: ( operationKey: string, result: CaptureResponse, ) => void or Promise<void>; /** * Called when a two-phase rule's payment is successfully verified at * `/request`time. Does not fire for one-phase (capture-only) rules, * which settle immediately and report through`onCapture` instead. * Does not fire when verification fails (the request gets a 402). * * The hook is awaited -- a slow async hook delays the caller. A * throw or rejected promise is caught and logged without affecting * the gateway response, which is already determined at this point. */ onAuthorize?: ( operationKey: string, result: AuthorizeResponse, ) => void or Promise<void>; }` |

### AuthorizeResponse

| Type                | Type |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthorizeResponse` | `    | { protocol: "x402v1"; verification: x402VerifyResponseV1 } or { protocol: "x402v2"; verification: x402VerifyResponseV2 } or { protocol: "mpp"; verification: mppReceipt }` |

### SettledPayment

| Type             | Type |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SettledPayment` | `    | { protocol: "x402v1"; settlement: x402SettleResponseV1 } or { protocol: "x402v2"; settlement: x402SettleResponseV2 } or { protocol: "mpp"; settlement: mppReceipt }` |

### RequestContext

| Type             | Type                          |
| ---------------- | ----------------------------- |
| `RequestContext` | `typeof requestContext.infer` |

### ResponseContext

| Type              | Type                           |
| ----------------- | ------------------------------ |
| `ResponseContext` | `typeof responseContext.infer` |

### GatewayRequestResult

| Type                   | Type                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `GatewayRequestResult` | `{ status: number; headers?: Record<string, string>; body?: unknown; }` |

### GatewayResponseResult

| Type                    | Type                  |
| ----------------------- | --------------------- |
| `GatewayResponseResult` | `{ status: number; }` |

### CapturePhase

| Type           | Type                    |
| -------------- | ----------------------- |
| `CapturePhase` | `request" or "response` |

### CaptureError

| Type           | Type                                    |
| -------------- | --------------------------------------- |
| `CaptureError` | `{ status: number; message?: string; }` |

### CaptureRequestInfo

| Type                 | Type                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `CaptureRequestInfo` | `{ method: string; path: string; headers: Record<string, string>; }` |

### CaptureResponse

| Type              | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CaptureResponse` | `{ phase: CapturePhase; settled: boolean; amount: Record<string, string>; // The original client request's method, path, and headers as // forwarded by the gateway. Useful for correlating settlement // events with access logs (e.g. via x-request-id). request: CaptureRequestInfo; // When settlement is attempted and fails, the error is propagated // here. Absent for successful settlements. error?: CaptureError; trace?: EvalTrace; // Present when settlement succeeded at this phase and a payment // handler returned a receipt. Absent when settlement failed // (`settled: false`, `error` is set). payment?: SettledPayment; }` |

### GatewayHandler

| Type             | Type                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GatewayHandler` | `{ handleRequest(ctx: RequestContext): Promise<GatewayRequestResult>; handleResponse(ctx: ResponseContext): Promise<GatewayResponseResult>; }` |

<!-- TSDOC_END -->
