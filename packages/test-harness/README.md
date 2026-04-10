# @faremeter/test-harness

In-process test harness for x402 protocol testing without network calls.

## Installation

```bash
pnpm install @faremeter/test-harness
```

## Features

- In-process testing - No network calls or external services
- Interceptor pattern - Inject failures, delays, and custom responses
- Composable - Combine interceptors for complex scenarios
- Test scheme - Simple payment scheme for protocol validation
- Framework agnostic - Works with any test runner

## API Reference

<!-- TSDOC_START -->

## Functions

- [chooseFirst](#choosefirst)
- [chooseCheapest](#choosecheapest)
- [chooseMostExpensive](#choosemostexpensive)
- [chooseByAsset](#choosebyasset)
- [chooseByNetwork](#choosebynetwork)
- [chooseByScheme](#choosebyscheme)
- [chooseByIndex](#choosebyindex)
- [chooseNone](#choosenone)
- [chooseWithInspection](#choosewithinspection)
- [chooseWithFilter](#choosewithfilter)
- [composeInterceptors](#composeinterceptors)
- [composeHandlerInterceptors](#composehandlerinterceptors)
- [isInProcessConfig](#isinprocessconfig)
- [isMatchingRequirement](#ismatchingrequirement)
- [accepts](#accepts)
- [acceptsV2](#acceptsv2)
- [getURLFromRequestInfo](#geturlfromrequestinfo)
- [isResourceContextV1](#isresourcecontextv1)
- [isResourceContextV2](#isresourcecontextv2)
- [isResourceContextMPP](#isresourcecontextmpp)
- [defaultResourceHandler](#defaultresourcehandler)
- [generateTestId](#generatetestid)
- [createTestFacilitatorHandler](#createtestfacilitatorhandler)
- [createTestPaymentHandler](#createtestpaymenthandler)
- [createTestMPPHandler](#createtestmpphandler)
- [createTestMPPPaymentHandler](#createtestmpppaymenthandler)
- [matchFacilitatorAccepts](#matchfacilitatoraccepts)
- [matchFacilitatorVerify](#matchfacilitatorverify)
- [matchFacilitatorSettle](#matchfacilitatorsettle)
- [matchFacilitatorSupported](#matchfacilitatorsupported)
- [matchFacilitator](#matchfacilitator)
- [matchResource](#matchresource)
- [and](#and)
- [or](#or)
- [not](#not)
- [matchURL](#matchurl)
- [matchMethod](#matchmethod)
- [matchAll](#matchall)
- [matchNone](#matchnone)
- [jsonResponse](#jsonresponse)
- [verifyFailedResponse](#verifyfailedresponse)
- [verifySuccessResponse](#verifysuccessresponse)
- [settleFailedResponse](#settlefailedresponse)
- [settleFailedResponseV2](#settlefailedresponsev2)
- [settleSuccessResponse](#settlesuccessresponse)
- [settleSuccessResponseV2](#settlesuccessresponsev2)
- [paymentRequiredResponse](#paymentrequiredresponse)
- [networkError](#networkerror)
- [timeoutError](#timeouterror)
- [httpError](#httperror)
- [createFailureInterceptor](#createfailureinterceptor)
- [failOnce](#failonce)
- [failNTimes](#failntimes)
- [failUntilCleared](#failuntilcleared)
- [failWhen](#failwhen)
- [createDelayInterceptor](#createdelayinterceptor)
- [createResponseDelayInterceptor](#createresponsedelayinterceptor)
- [createVariableDelayInterceptor](#createvariabledelayinterceptor)
- [createV2ResponseInterceptor](#createv2responseinterceptor)
- [createRequestHook](#createrequesthook)
- [createResponseHook](#createresponsehook)
- [createHook](#createhook)
- [createCaptureInterceptor](#createcaptureinterceptor)
- [createLoggingInterceptor](#createlogginginterceptor)
- [createConsoleLoggingInterceptor](#createconsolelogginginterceptor)
- [createEventCollector](#createeventcollector)
- [suppressConsoleErrors](#suppressconsoleerrors)
- [createNonMatchingHandler](#createnonmatchinghandler)
- [createThrowingHandler](#createthrowinghandler)
- [createThrowingExecHandler](#createthrowingexechandler)
- [createNullPayloadHandler](#createnullpayloadhandler)
- [createEmptyPayloadHandler](#createemptypayloadhandler)
- [createWorkingHandler](#createworkinghandler)
- [createInvalidPayloadHandler](#createinvalidpayloadhandler)
- [createSimpleFacilitatorHandler](#createsimplefacilitatorhandler)

### chooseFirst

Chooser that selects the first available payment option.

| Function      | Type                                              |
| ------------- | ------------------------------------------------- |
| `chooseFirst` | `(execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `execers`: - Available payment execers.

Returns:

The first execer in the list.

### chooseCheapest

Chooser that selects the cheapest payment option by maxAmountRequired.

| Function         | Type                                              |
| ---------------- | ------------------------------------------------- |
| `chooseCheapest` | `(execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `execers`: - Available payment execers.

Returns:

The execer with the lowest amount.

### chooseMostExpensive

Chooser that selects the most expensive payment option by maxAmountRequired.

| Function              | Type                                              |
| --------------------- | ------------------------------------------------- |
| `chooseMostExpensive` | `(execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `execers`: - Available payment execers.

Returns:

The execer with the highest amount.

### chooseByAsset

Creates a chooser that selects by asset name.

| Function        | Type                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `chooseByAsset` | `(asset: string) => (execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `asset`: - Asset name to match (case-insensitive).

Returns:

A chooser function.

### chooseByNetwork

Creates a chooser that selects by network name.

| Function          | Type                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `chooseByNetwork` | `(network: string) => (execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `network`: - Network name to match (case-insensitive).

Returns:

A chooser function.

### chooseByScheme

Creates a chooser that selects by payment scheme.

| Function         | Type                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `chooseByScheme` | `(scheme: string) => (execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `scheme`: - Scheme name to match (case-insensitive).

Returns:

A chooser function.

### chooseByIndex

Creates a chooser that selects by array index.

| Function        | Type                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `chooseByIndex` | `(index: number) => (execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `index`: - Zero-based index of the option to select.

Returns:

A chooser function.

### chooseNone

Chooser that always throws, useful for testing "no suitable option" paths.

| Function     | Type          |
| ------------ | ------------- |
| `chooseNone` | `() => never` |

### chooseWithInspection

Wraps a chooser to inspect options before choosing.

| Function               | Type                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chooseWithInspection` | `(inspector: (execers: PaymentExecerV1[]) => void, inner: (execers: PaymentExecerV1[]) => PaymentExecerV1) => (execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `inspector`: - Callback to inspect available options.
- `inner`: - Chooser to delegate to after inspection.

Returns:

A chooser that inspects then delegates.

### chooseWithFilter

Wraps a chooser to filter options before choosing.

| Function           | Type                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chooseWithFilter` | `(filter: (execer: PaymentExecerV1) => boolean, inner: (execers: PaymentExecerV1[]) => PaymentExecerV1) => (execers: PaymentExecerV1[]) => PaymentExecerV1` |

Parameters:

- `filter`: - Predicate to filter available options.
- `inner`: - Chooser to delegate to after filtering.

Returns:

A chooser that filters then delegates.

### composeInterceptors

Compose multiple interceptors into a single interceptor.

Interceptors are applied right-to-left (last interceptor wraps innermost).
This means the first interceptor in the array sees the request first and
the response last.

| Function              | Type                                              |
| --------------------- | ------------------------------------------------- |
| `composeInterceptors` | `(...interceptors: Interceptor[]) => Interceptor` |

Examples:

```ts
const composed = composeInterceptors(
  loggingInterceptor, // Sees request first, response last
  failureInterceptor, // Sees request second
  delayInterceptor, // Innermost - closest to actual fetch
);
```

### composeHandlerInterceptors

Compose multiple handler interceptors into a single interceptor.

Interceptors are applied right-to-left (last interceptor wraps innermost).
This means the first interceptor in the array sees calls first and results
last, matching the semantics of {@link composeInterceptors}.

| Function                     | Type                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| `composeHandlerInterceptors` | `(...interceptors: HandlerInterceptor[]) => HandlerInterceptor` |

### isInProcessConfig

Type guard for in-process handler configuration.

| Function            | Type                                                       |
| ------------------- | ---------------------------------------------------------- |
| `isInProcessConfig` | `(config: TestHarnessConfig) => config is InProcessConfig` |

### isMatchingRequirement

Checks if a payment requirement matches the test scheme and network.

| Function                | Type                                                     |
| ----------------------- | -------------------------------------------------------- |
| `isMatchingRequirement` | `(req: { scheme: string; network: string; }) => boolean` |

### accepts

Creates a payment requirements object with test defaults (v1 format).
Override specific fields by passing a partial:
accepts({ maxAmountRequired: "500" })

| Function  | Type                                             |
| --------- | ------------------------------------------------ |
| `accepts` | `(overrides?: any) => x402PaymentRequirementsV1` |

### acceptsV2

Creates a payment requirements object with test defaults (v2 format).
Override specific fields by passing a partial:
acceptsV2({ amount: "500" })

| Function    | Type                                           |
| ----------- | ---------------------------------------------- |
| `acceptsV2` | `(overrides?: any) => x402PaymentRequirements` |

### getURLFromRequestInfo

Extracts the URL string from various request input types.

| Function                | Type                                    |
| ----------------------- | --------------------------------------- |
| `getURLFromRequestInfo` | `(input: RequestInfo or URL) => string` |

Parameters:

- `input`: - A URL string, URL object, or Request object.

Returns:

The URL as a string.

### isResourceContextV1

Type guard to check if context is v1.

| Function              | Type                                                 |
| --------------------- | ---------------------------------------------------- |
| `isResourceContextV1` | `(ctx: ResourceContext) => ctx is ResourceContextV1` |

### isResourceContextV2

Type guard to check if context is v2.

| Function              | Type                                                 |
| --------------------- | ---------------------------------------------------- |
| `isResourceContextV2` | `(ctx: ResourceContext) => ctx is ResourceContextV2` |

### isResourceContextMPP

| Function               | Type                                                  |
| ---------------------- | ----------------------------------------------------- |
| `isResourceContextMPP` | `(ctx: ResourceContext) => ctx is ResourceContextMPP` |

### defaultResourceHandler

| Function                 | Type              |
| ------------------------ | ----------------- |
| `defaultResourceHandler` | `ResourceHandler` |

### generateTestId

Generates a unique test payment identifier.

| Function         | Type           |
| ---------------- | -------------- |
| `generateTestId` | `() => string` |

Returns:

A string like "test-1234567890-abc123".

### createTestFacilitatorHandler

Create a test facilitator handler.

This handler validates protocol structure without any cryptographic
operations, making it suitable for testing the x402 protocol flow.

| Function                       | Type                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `createTestFacilitatorHandler` | `(opts: CreateTestFacilitatorHandlerOpts) => FacilitatorHandler` |

### createTestPaymentHandler

Create a test payment handler.

This handler creates simple test payment payloads without any cryptographic
operations, making it suitable for testing the x402 protocol flow.

| Function                   | Type                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `createTestPaymentHandler` | `(opts?: CreateTestPaymentHandlerOpts) => PaymentHandlerV1` |

### createTestMPPHandler

| Function               | Type                                                    |
| ---------------------- | ------------------------------------------------------- |
| `createTestMPPHandler` | `(opts?: CreateTestMPPHandlerOpts) => MPPMethodHandler` |

### createTestMPPPaymentHandler

| Function                      | Type                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `createTestMPPPaymentHandler` | `(opts?: CreateTestMPPPaymentHandlerOpts) => MPPPaymentHandler` |

### matchFacilitatorAccepts

| Function                  | Type             |
| ------------------------- | ---------------- |
| `matchFacilitatorAccepts` | `RequestMatcher` |

### matchFacilitatorVerify

| Function                 | Type             |
| ------------------------ | ---------------- |
| `matchFacilitatorVerify` | `RequestMatcher` |

### matchFacilitatorSettle

| Function                 | Type             |
| ------------------------ | ---------------- |
| `matchFacilitatorSettle` | `RequestMatcher` |

### matchFacilitatorSupported

| Function                    | Type             |
| --------------------------- | ---------------- |
| `matchFacilitatorSupported` | `RequestMatcher` |

### matchFacilitator

| Function           | Type             |
| ------------------ | ---------------- |
| `matchFacilitator` | `RequestMatcher` |

### matchResource

| Function        | Type             |
| --------------- | ---------------- |
| `matchResource` | `RequestMatcher` |

### and

Combines matchers with logical AND: all must match.

| Function | Type                                                |
| -------- | --------------------------------------------------- |
| `and`    | `(...matchers: RequestMatcher[]) => RequestMatcher` |

Parameters:

- `matchers`: - Matchers to combine.

Returns:

A matcher that succeeds only if all provided matchers succeed.

### or

Combines matchers with logical OR: any must match.

| Function | Type                                                |
| -------- | --------------------------------------------------- |
| `or`     | `(...matchers: RequestMatcher[]) => RequestMatcher` |

Parameters:

- `matchers`: - Matchers to combine.

Returns:

A matcher that succeeds if any provided matcher succeeds.

### not

Negates a matcher.

| Function | Type                                          |
| -------- | --------------------------------------------- |
| `not`    | `(matcher: RequestMatcher) => RequestMatcher` |

Parameters:

- `matcher`: - Matcher to negate.

Returns:

A matcher that succeeds when the provided matcher fails.

### matchURL

Creates a matcher that checks the URL against a pattern.

| Function   | Type                                            |
| ---------- | ----------------------------------------------- |
| `matchURL` | `(pattern: string or RegExp) => RequestMatcher` |

Parameters:

- `pattern`: - String to search for or RegExp to test.

Returns:

A matcher that succeeds if the URL matches the pattern.

### matchMethod

Creates a matcher that checks the HTTP method.

| Function      | Type                                 |
| ------------- | ------------------------------------ |
| `matchMethod` | `(method: string) => RequestMatcher` |

Parameters:

- `method`: - HTTP method to match (case-insensitive).

Returns:

A matcher that succeeds if the request uses the specified method.

### matchAll

| Function   | Type             |
| ---------- | ---------------- |
| `matchAll` | `RequestMatcher` |

### matchNone

| Function    | Type             |
| ----------- | ---------------- |
| `matchNone` | `RequestMatcher` |

### jsonResponse

Creates a JSON Response with the given status and body.

| Function       | Type                                         |
| -------------- | -------------------------------------------- |
| `jsonResponse` | `(status: number, body: object) => Response` |

Parameters:

- `status`: - HTTP status code.
- `body`: - Object to serialize as JSON.

Returns:

A Response with JSON content type.

### verifyFailedResponse

Creates a failed verify response.

| Function               | Type                           |
| ---------------------- | ------------------------------ |
| `verifyFailedResponse` | `(reason: string) => Response` |

Parameters:

- `reason`: - Reason for verification failure.

Returns:

A 200 Response with isValid: false.

### verifySuccessResponse

Creates a successful verify response.

| Function                | Type             |
| ----------------------- | ---------------- |
| `verifySuccessResponse` | `() => Response` |

Returns:

A 200 Response with isValid: true.

### settleFailedResponse

Creates a failed settle response (v1 format).

| Function               | Type                                |
| ---------------------- | ----------------------------------- |
| `settleFailedResponse` | `(errorReason: string) => Response` |

Parameters:

- `errorReason`: - Reason for settlement failure.

Returns:

A 200 Response with success: false.

### settleFailedResponseV2

Creates a failed settle response (v2 format).

| Function                 | Type                                                 |
| ------------------------ | ---------------------------------------------------- |
| `settleFailedResponseV2` | `(errorReason: string, network: string) => Response` |

Parameters:

- `errorReason`: - Reason for settlement failure.
- `network`: - Network identifier for the response.

Returns:

A 200 Response with success: false.

### settleSuccessResponse

Creates a successful settle response (v1 format).

| Function                | Type                                                 |
| ----------------------- | ---------------------------------------------------- |
| `settleSuccessResponse` | `(transaction: string, network: string) => Response` |

Parameters:

- `transaction`: - Transaction identifier.
- `network`: - Network identifier.

Returns:

A 200 Response with success: true.

### settleSuccessResponseV2

Creates a successful settle response (v2 format).

| Function                  | Type                                                 |
| ------------------------- | ---------------------------------------------------- |
| `settleSuccessResponseV2` | `(transaction: string, network: string) => Response` |

Parameters:

- `transaction`: - Transaction identifier.
- `network`: - Network identifier.

Returns:

A 200 Response with success: true.

### paymentRequiredResponse

Creates a 402 Payment Required response.

| Function                  | Type                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `paymentRequiredResponse` | `(accepts: x402PaymentRequirements[], error?: string) => Response` |

Parameters:

- `accepts`: - Payment requirements the server accepts.
- `error`: - Optional error message.

Returns:

A 402 Response with x402Version: 1.

### networkError

Creates a network error for testing error handling.

| Function       | Type                          |
| -------------- | ----------------------------- |
| `networkError` | `(message?: string) => Error` |

Parameters:

- `message`: - Error message.

Returns:

An Error to be thrown by interceptors.

### timeoutError

Creates a timeout error for testing timeout handling.

| Function       | Type          |
| -------------- | ------------- |
| `timeoutError` | `() => Error` |

Returns:

An Error with "Request timed out" message.

### httpError

Creates an HTTP error response.

| Function    | Type                                            |
| ----------- | ----------------------------------------------- |
| `httpError` | `(status: number, message: string) => Response` |

Parameters:

- `status`: - HTTP status code.
- `message`: - Error message.

Returns:

A Response with the error JSON body.

### createFailureInterceptor

Creates an interceptor that fails matching requests.

| Function                   | Type                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `createFailureInterceptor` | `(match: RequestMatcher, failFn: () => Response or Error or Promise<Response or Error>) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to fail.
- `failFn`: - Function returning the failure (Response or Error).

Returns:

An interceptor that fails matching requests.

### failOnce

Creates an interceptor that fails the first matching request only.

| Function   | Type                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| `failOnce` | `(match: RequestMatcher, failFn: () => Response or Error) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to fail.
- `failFn`: - Function returning the failure.

Returns:

An interceptor that fails once then passes through.

### failNTimes

Creates an interceptor that fails the first N matching requests.

| Function     | Type                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| `failNTimes` | `(n: number, match: RequestMatcher, failFn: () => Response or Error) => Interceptor` |

Parameters:

- `n`: - Number of times to fail before passing through.
- `match`: - Predicate to determine which requests to fail.
- `failFn`: - Function returning the failure.

Returns:

An interceptor that fails N times then passes through.

### failUntilCleared

Creates an interceptor that fails until manually cleared.

Call `clear()` on the returned interceptor to stop failing.

| Function           | Type                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `failUntilCleared` | `(match: RequestMatcher, failFn: () => Response or Error) => Interceptor and { clear(): void; }` |

Parameters:

- `match`: - Predicate to determine which requests to fail.
- `failFn`: - Function returning the failure.

Returns:

An interceptor with a `clear()` method.

### failWhen

Creates an interceptor that fails based on a dynamic condition.

The condition receives the URL and attempt count, allowing patterns
like "fail every other request" or "fail first 3 attempts".

| Function   | Type                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `failWhen` | `(match: RequestMatcher, shouldFail: (ctx: { url: string; attemptCount: number; }) => boolean, failFn: () => Response or Error) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to consider.
- `shouldFail`: - Condition that receives context with attempt count.
- `failFn`: - Function returning the failure.

Returns:

An interceptor with conditional failure logic.

### createDelayInterceptor

Creates an interceptor that delays matching requests before sending.

| Function                 | Type                                                      |
| ------------------------ | --------------------------------------------------------- |
| `createDelayInterceptor` | `(match: RequestMatcher, delayMs: number) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to delay.
- `delayMs`: - Delay in milliseconds.

Returns:

An interceptor that adds request delay.

### createResponseDelayInterceptor

Creates an interceptor that delays matching responses after receiving.

| Function                         | Type                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `createResponseDelayInterceptor` | `(match: RequestMatcher, delayMs: number) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which responses to delay.
- `delayMs`: - Delay in milliseconds.

Returns:

An interceptor that adds response delay.

### createVariableDelayInterceptor

Creates an interceptor with variable delay based on request context.

| Function                         | Type                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createVariableDelayInterceptor` | `(match: RequestMatcher, getDelay: (url: string, init?: RequestInit or undefined) => number) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to delay.
- `getDelay`: - Function returning delay in ms for each request.

Returns:

An interceptor with dynamic delay.

### createV2ResponseInterceptor

Creates an interceptor that transforms v1 402 responses to v2 format.

This allows testing v2 client behavior by making the middleware appear
to respond with v2 format even though it defaults to v1.

The transformation:

- Parses the JSON body as v1 PaymentRequiredResponse
- Converts to v2 PaymentRequiredResponse format
- Encodes as base64 in PAYMENT-REQUIRED header
- Returns 402 with the new header

| Function                      | Type                |
| ----------------------------- | ------------------- |
| `createV2ResponseInterceptor` | `() => Interceptor` |

### createRequestHook

Creates an interceptor that calls a hook before matching requests.

| Function            | Type                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `createRequestHook` | `(match: RequestMatcher, hook: (url: string, init?: RequestInit or undefined) => void or Promise<void>) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to hook.
- `hook`: - Callback invoked before the request is sent.

Returns:

An interceptor with request-side hooks.

### createResponseHook

Creates an interceptor that calls a hook after matching responses.

| Function             | Type                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `createResponseHook` | `(match: RequestMatcher, hook: (url: string, response: Response, init?: RequestInit or undefined) => void or Promise<void>) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which responses to hook.
- `hook`: - Callback invoked after the response is received.

Returns:

An interceptor with response-side hooks.

### createHook

Creates an interceptor with both request and response hooks.

| Function     | Type                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createHook` | `(match: RequestMatcher, hooks: { onRequest?: ((url: string, init?: RequestInit or undefined) => void or Promise<void>) or undefined; onResponse?: ((url: string, response: Response, init?: RequestInit or undefined) => void or Promise<...>) or undefined; }) => Interceptor` |

Parameters:

- `match`: - Predicate to determine which requests to hook.
- `hooks`: - Object with optional onRequest and onResponse callbacks.

Returns:

An interceptor with both-side hooks.

### createCaptureInterceptor

Creates an interceptor that captures matching requests for later inspection.

| Function                   | Type                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `createCaptureInterceptor` | `(match: RequestMatcher) => { interceptor: Interceptor; captured: CapturedRequest[]; clear: () => void; }` |

Parameters:

- `match`: - Predicate to determine which requests to capture.

Returns:

Object with the interceptor, captured array, and clear function.

### createLoggingInterceptor

Creates an interceptor that logs all requests, responses, and errors.

| Function                   | Type                                              |
| -------------------------- | ------------------------------------------------- |
| `createLoggingInterceptor` | `(log: (event: LogEvent) => void) => Interceptor` |

Parameters:

- `log`: - Callback to receive log events.

Returns:

An interceptor that logs activity.

### createConsoleLoggingInterceptor

Creates an interceptor that logs to the console with a prefix.

| Function                          | Type                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `createConsoleLoggingInterceptor` | `(prefix?: string, log?: { log: (msg: string) => void; error: (msg: string) => void; }) => Interceptor` |

Parameters:

- `prefix`: - Prefix for log messages.
- `log`: - Logger with log and error methods (defaults to console).

Returns:

An interceptor that logs to console.

### createEventCollector

Creates an interceptor that collects events into an array for assertions.

| Function               | Type                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `createEventCollector` | `() => { interceptor: Interceptor; events: LogEvent[]; clear: () => void; }` |

Returns:

Object with the interceptor, events array, and clear function.

### suppressConsoleErrors

Suppresses console.error output during tests.
Returns a restore function to be called in teardown.

Usage with tap:
t.teardown(suppressConsoleErrors());

| Function                | Type               |
| ----------------------- | ------------------ |
| `suppressConsoleErrors` | `() => () => void` |

### createNonMatchingHandler

Creates a payment handler that returns no matching execers.
Useful for testing "no handler matches" scenarios.

| Function                   | Type                     |
| -------------------------- | ------------------------ |
| `createNonMatchingHandler` | `() => PaymentHandlerV1` |

### createThrowingHandler

Creates a payment handler that throws during the match phase.

| Function                | Type                                    |
| ----------------------- | --------------------------------------- |
| `createThrowingHandler` | `(message: string) => PaymentHandlerV1` |

### createThrowingExecHandler

Creates a payment handler that throws during exec().

| Function                    | Type                                    |
| --------------------------- | --------------------------------------- |
| `createThrowingExecHandler` | `(message: string) => PaymentHandlerV1` |

### createNullPayloadHandler

Creates a payment handler that returns null payload.

| Function                   | Type                     |
| -------------------------- | ------------------------ |
| `createNullPayloadHandler` | `() => PaymentHandlerV1` |

### createEmptyPayloadHandler

Creates a payment handler that returns an empty payload object.

| Function                    | Type                     |
| --------------------------- | ------------------------ |
| `createEmptyPayloadHandler` | `() => PaymentHandlerV1` |

### createWorkingHandler

Creates a payment handler that works correctly.
Useful for fallback testing scenarios.

| Function               | Type                     |
| ---------------------- | ------------------------ |
| `createWorkingHandler` | `() => PaymentHandlerV1` |

### createInvalidPayloadHandler

Creates a payment handler with a custom payload factory.
Useful for testing invalid/edge-case payloads.

| Function                      | Type                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `createInvalidPayloadHandler` | `(payloadFactory: (requirements: x402PaymentRequirementsV1) => object) => PaymentHandlerV1` |

### createSimpleFacilitatorHandler

Creates a minimal facilitator handler for testing.
Useful for testing /supported endpoint behavior.

| Function                         | Type                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `createSimpleFacilitatorHandler` | `(opts: CreateSimpleFacilitatorHandlerOpts) => FacilitatorHandler` |

## Constants

- [TEST_SCHEME](#test_scheme)
- [TEST_NETWORK](#test_network)
- [TEST_ASSET](#test_asset)
- [TEST_MPP_METHOD](#test_mpp_method)
- [TEST_MPP_INTENT](#test_mpp_intent)
- [TEST_MPP_REALM](#test_mpp_realm)
- [TEST_MPP_SECRET](#test_mpp_secret)

### TEST_SCHEME

| Constant      | Type     |
| ------------- | -------- |
| `TEST_SCHEME` | `"test"` |

### TEST_NETWORK

| Constant       | Type           |
| -------------- | -------------- |
| `TEST_NETWORK` | `"test-local"` |

### TEST_ASSET

| Constant     | Type     |
| ------------ | -------- |
| `TEST_ASSET` | `"TEST"` |

### TEST_MPP_METHOD

| Constant          | Type            |
| ----------------- | --------------- |
| `TEST_MPP_METHOD` | `"test-solana"` |

### TEST_MPP_INTENT

| Constant          | Type       |
| ----------------- | ---------- |
| `TEST_MPP_INTENT` | `"charge"` |

### TEST_MPP_REALM

| Constant         | Type           |
| ---------------- | -------------- |
| `TEST_MPP_REALM` | `"test-realm"` |

### TEST_MPP_SECRET

| Constant          | Type                      |
| ----------------- | ------------------------- |
| `TEST_MPP_SECRET` | `Uint8Array<ArrayBuffer>` |

## TestHarness

TestHarness provides an in-process test environment for the x402 protocol.

Supports two modes:

- **HTTP mode** (`accepts` + `facilitatorHandlers`): mounts facilitator
  routes and the middleware communicates via HTTP. Supports middleware
  interceptors.
- **In-process mode** (`x402Handlers` + `pricing`): handlers run directly
  in the middleware. Supports handler interceptors.

### Methods

- [createClientFetch](#createclientfetch)
- [setResourceHandler](#setresourcehandler)
- [createFetch](#createfetch)
- [addClientInterceptor](#addclientinterceptor)
- [addMiddlewareInterceptor](#addmiddlewareinterceptor)
- [addHandlerInterceptor](#addhandlerinterceptor)
- [clearInterceptors](#clearinterceptors)
- [reset](#reset)

#### createClientFetch

Create a fetch function for client->middleware calls.
This applies client interceptors and routes to the Hono app.

| Method              | Type                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `createClientFetch` | `() => (input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<Response>` |

#### setResourceHandler

Set the resource handler that responds after successful payment.

| Method               | Type                                 |
| -------------------- | ------------------------------------ |
| `setResourceHandler` | `(handler: ResourceHandler) => void` |

#### createFetch

Create a fetch function that handles the full x402 payment flow.

| Method        | Type                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFetch` | `(opts?: { payerChooser?: ((execers: PaymentExecerV1[]) => any) or undefined; } or undefined) => (input: RequestInfo or URL, init?: RequestInit or undefined) => Promise<Response>` |

Parameters:

- `opts.payerChooser`: - Function to choose which payment option to use.
  Receives v1 PaymentExecerV1[] for compatibility with v1 protocol tests.
  The chosen execer is converted back to v2 internally.

#### addClientInterceptor

Add an interceptor to the client chain (between test code and middleware).

| Method                 | Type                                 |
| ---------------------- | ------------------------------------ |
| `addClientInterceptor` | `(interceptor: Interceptor) => void` |

#### addMiddlewareInterceptor

Add an interceptor to the middleware chain (between middleware and facilitator).

| Method                     | Type                                 |
| -------------------------- | ------------------------------------ |
| `addMiddlewareInterceptor` | `(interceptor: Interceptor) => void` |

#### addHandlerInterceptor

| Method                  | Type                                        |
| ----------------------- | ------------------------------------------- |
| `addHandlerInterceptor` | `(interceptor: HandlerInterceptor) => void` |

#### clearInterceptors

Clear all interceptors added after construction.

| Method              | Type         |
| ------------------- | ------------ |
| `clearInterceptors` | `() => void` |

#### reset

Reset harness state (interceptors, resource handler).

| Method  | Type         |
| ------- | ------------ |
| `reset` | `() => void` |

## Types

- [Interceptor](#interceptor)
- [RequestMatcher](#requestmatcher)
- [HandlerInterceptor](#handlerinterceptor)
- [SettleMode](#settlemode)
- [InProcessConfig](#inprocessconfig)
- [HTTPConfig](#httpconfig)
- [TestHarnessConfig](#testharnessconfig)
- [ResourceContextV1](#resourcecontextv1)
- [ResourceContextV2](#resourcecontextv2)
- [ResourceContextMPP](#resourcecontextmpp)
- [ResourceContextX402](#resourcecontextx402)
- [ResourceContext](#resourcecontext)
- [ResourceResult](#resourceresult)
- [ResourceHandler](#resourcehandler)
- [TestPaymentPayload](#testpaymentpayload)
- [AmountPolicy](#amountpolicy)
- [CreateTestFacilitatorHandlerOpts](#createtestfacilitatorhandleropts)
- [CreateTestPaymentHandlerOpts](#createtestpaymenthandleropts)
- [CreateTestMPPHandlerOpts](#createtestmpphandleropts)
- [CreateTestMPPPaymentHandlerOpts](#createtestmpppaymenthandleropts)
- [LogEvent](#logevent)
- [CreateSimpleFacilitatorHandlerOpts](#createsimplefacilitatorhandleropts)

### Interceptor

A function that wraps fetch to intercept requests and responses.

Interceptors can modify requests before they're sent, inspect or modify
responses, inject failures, add delays, or log activity.

| Type          | Type                                                             |
| ------------- | ---------------------------------------------------------------- |
| `Interceptor` | `( fetch: typeof globalThis.fetch, ) => typeof globalThis.fetch` |

### RequestMatcher

Predicate function that determines whether a request should be matched.

Used by interceptors to selectively apply behavior to specific requests.

| Type             | Type                                           |
| ---------------- | ---------------------------------------------- |
| `RequestMatcher` | `(url: string, init?: RequestInit) => boolean` |

### HandlerInterceptor

A function that wraps a `FacilitatorHandler` to intercept handler
method calls. Used for in-process handler testing where there is no HTTP
layer to intercept.

| Type                 | Type                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `HandlerInterceptor` | `( handler: import("@faremeter/types/facilitator").FacilitatorHandler, ) => import("@faremeter/types/facilitator").FacilitatorHandler` |

### SettleMode

How the middleware handles payment verification and settlement.

- `"settle-only"` - Skip verification, settle directly (faster tests).
- `"verify-then-settle"` - Verify payment before settling (more realistic).

| Type         | Type                                  |
| ------------ | ------------------------------------- |
| `SettleMode` | `settle-only" or "verify-then-settle` |

### InProcessConfig

Configuration for in-process handler testing. Handlers run directly
in the middleware with no facilitator HTTP service.

| Type              | Type                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InProcessConfig` | `BaseConfig and { x402Handlers?: FacilitatorHandler[]; mppMethodHandlers?: MPPMethodHandler[]; pricing: ResourcePricing[]; handlerInterceptors?: HandlerInterceptor[]; }` |

### HTTPConfig

Configuration for HTTP facilitator testing. The test harness mounts
facilitator routes and the middleware communicates via HTTP.

| Type         | Type                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPConfig` | `BaseConfig and { accepts: Partial<x402PaymentRequirements>[]; facilitatorHandlers: FacilitatorHandler[]; middlewareInterceptors?: Interceptor[]; }` |

### TestHarnessConfig

Configuration for {@link TestHarness }.

| Type                | Type                            |
| ------------------- | ------------------------------- |
| `TestHarnessConfig` | `InProcessConfig or HTTPConfig` |

### ResourceContextV1

Resource context for v1 protocol.

| Type                | Type                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResourceContextV1` | `ResourceContextBase and { protocolVersion: 1; paymentRequirements: x402PaymentRequirementsV1; paymentPayload: x402PaymentPayloadV1; settleResponse: x402SettleResponseV1; verifyResponse?: x402VerifyResponseV1 or undefined; }` |

### ResourceContextV2

Resource context for v2 protocol.

| Type                | Type                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResourceContextV2` | `ResourceContextBase and { protocolVersion: 2; paymentRequirements: x402PaymentRequirements; paymentPayload: x402PaymentPayload; settleResponse: x402SettleResponse; verifyResponse?: x402VerifyResponse or undefined; }` |

### ResourceContextMPP

Resource context for MPP protocol.

| Type                 | Type                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `ResourceContextMPP` | `ResourceContextBase and { protocolVersion: "mpp"; credential: mppCredential; receipt: mppReceipt; }` |

### ResourceContextX402

Resource context for x402 protocols (v1 or v2).
Use when the handler only needs to work with x402 payment fields.

| Type                  | Type                                     |
| --------------------- | ---------------------------------------- |
| `ResourceContextX402` | `ResourceContextV1 or ResourceContextV2` |

### ResourceContext

Resource context passed to the resource handler after successful payment.
Discriminated union based on protocolVersion.

| Type              | Type                                        |
| ----------------- | ------------------------------------------- |
| `ResourceContext` | `ResourceContextX402 or ResourceContextMPP` |

### ResourceResult

| Type             | Type                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `ResourceResult` | `{ status: number; body: unknown; headers?: Record<string, string>; }` |

### ResourceHandler

| Type              | Type                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `ResourceHandler` | `( ctx: ResourceContext, ) => ResourceResult or Promise<ResourceResult>` |

### TestPaymentPayload

Payload structure for test payment scheme transactions.

| Type                 | Type                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `TestPaymentPayload` | `{ testId: string; amount: string; timestamp: number; metadata?: Record<string, unknown> or undefined; }` |

### AmountPolicy

Policy that decides whether a settlement amount is acceptable
given the signed payment amount. The default is exact match.

| Type           | Type                                                         |
| -------------- | ------------------------------------------------------------ |
| `AmountPolicy` | `( settleAmount: bigint, signedAmount: bigint, ) => boolean` |

### CreateTestFacilitatorHandlerOpts

| Type                               | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateTestFacilitatorHandlerOpts` | `{ /** Address that should receive payments. */ payTo: string; /** * Decides whether a settlement amount is acceptable given the * signed payment amount. Defaults to exact match. Tests for * hold-and-settle schemes should pass * `(settle, signed) => settle <= signed`. */ amountPolicy?: AmountPolicy; /** Optional callback invoked during verify. */ onVerify?: ( requirements: x402PaymentRequirements, payload: x402PaymentPayload, testPayload: TestPaymentPayload, ) => void; /** Optional callback invoked during settle. */ onSettle?: ( requirements: x402PaymentRequirements, payload: x402PaymentPayload, testPayload: TestPaymentPayload, ) => void; }` |

### CreateTestPaymentHandlerOpts

Options for creating a test payment handler.

| Type                           | Type                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateTestPaymentHandlerOpts` | `{ /** Optional callback when requirements are matched. */ onMatch?: (requirements: x402PaymentRequirements) => void; /** Optional callback when payment is executed. */ onExec?: ( requirements: x402PaymentRequirements, payload: TestPaymentPayload, ) => void; /** Custom metadata to include in test payloads. */ metadata?: Record<string, unknown>; }` |

### CreateTestMPPHandlerOpts

| Type                       | Type                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateTestMPPHandlerOpts` | `{ method?: string; realm?: string; intents?: string[]; onChallenge?: ( intent: string, pricing: ResourcePricing, resourceURL: string, ) => void; onSettle?: (credential: mppCredential) => void; }` |

### CreateTestMPPPaymentHandlerOpts

| Type                              | Type                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateTestMPPPaymentHandlerOpts` | `{ method?: string; intent?: string; onMatch?: (challenge: mppChallengeParams) => void; onExec?: (challenge: mppChallengeParams) => void; }` |

### LogEvent

Event emitted by logging interceptors for requests, responses, and errors.

| Type       | Type                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `LogEvent` | `{ type: "request" or "response" or "error"; url: string; method?: string; status?: number; error?: string; timestamp: number; }` |

### CreateSimpleFacilitatorHandlerOpts

Options for creating a simple facilitator handler.

| Type                                 | Type                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateSimpleFacilitatorHandlerOpts` | `{ /** Network identifier for settle responses. */ networkId: string; /** Optional function returning supported payment kinds. */ getSupported?: () => Promise<x402SupportedKind>[]; }` |

<!-- TSDOC_END -->

## Examples

See integration tests in the [faremeter repository](https://github.com/faremeter/faremeter/tree/main/tests):

- [Success flow](https://github.com/faremeter/faremeter/blob/main/tests/x402v1/success.test.ts)
- [Verification failures](https://github.com/faremeter/faremeter/blob/main/tests/x402v1/verification-failures.test.ts)
- [Settlement failures](https://github.com/faremeter/faremeter/blob/main/tests/x402v1/settlement-failures.test.ts)

## Related Packages

- [@faremeter/fetch](https://www.npmjs.com/package/@faremeter/fetch) - Client-side fetch wrapper
- [@faremeter/middleware](https://www.npmjs.com/package/@faremeter/middleware) - Server-side middleware
- [@faremeter/facilitator](https://www.npmjs.com/package/@faremeter/facilitator) - Payment facilitator service

## License

LGPL-3.0-only
