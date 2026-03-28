# @faremeter/types

TypeScript type definitions and runtime validation for the x402 protocol and Faremeter ecosystem.

## Installation

```bash
pnpm install @faremeter/types
```

## Features

- Complete x402 protocol types
- Runtime validation with arktype
- Client and facilitator interfaces
- Chain-specific types (Solana, EVM)
- Type-safe across the entire ecosystem

## Subpath Exports

- `@faremeter/types` - Main exports
- `@faremeter/types/x402` - x402 protocol types
- `@faremeter/types/client` - Client-side types
- `@faremeter/types/facilitator` - Facilitator types
- `@faremeter/types/solana` - Solana-specific types
- `@faremeter/types/evm` - EVM-specific types

## API Reference

<!-- TSDOC_START -->

## Functions

- [caseInsensitiveLiteral](#caseinsensitiveliteral)
- [isValidationError](#isvalidationerror)
- [throwValidationError](#throwvalidationerror)
- [normalizePaymentRequiredResponse](#normalizepaymentrequiredresponse)
- [normalizeVerifyResponse](#normalizeverifyresponse)
- [normalizeSettleResponse](#normalizesettleresponse)
- [generateRequirementsMatcher](#generaterequirementsmatcher)
- [adaptRequirementsV1ToV2](#adaptrequirementsv1tov2)
- [adaptRequirementsV2ToV1](#adaptrequirementsv2tov1)
- [extractResourceInfoV1](#extractresourceinfov1)
- [adaptPayloadV1ToV2](#adaptpayloadv1tov2)
- [adaptPaymentRequiredResponseV1ToV2](#adaptpaymentrequiredresponsev1tov2)
- [adaptPaymentRequiredResponseV2ToV1](#adaptpaymentrequiredresponsev2tov1)
- [adaptVerifyResponseV2ToV1](#adaptverifyresponsev2tov1)
- [adaptVerifyResponseV1ToV2](#adaptverifyresponsev1tov2)
- [adaptSettleResponseV2ToV1](#adaptsettleresponsev2tov1)
- [adaptSettleResponseV2ToV1Legacy](#adaptsettleresponsev2tov1legacy)
- [adaptSettleResponseV1ToV2](#adaptsettleresponsev1tov2)
- [adaptSettleResponseLegacyToV2](#adaptsettleresponselegacytov2)
- [adaptSettleResponseLenientToV2](#adaptsettleresponselenienttov2)
- [adaptSupportedKindV2ToV1](#adaptsupportedkindv2tov1)
- [adaptSupportedKindV1ToV2](#adaptsupportedkindv1tov2)
- [adaptPaymentHandlerV1ToV2](#adaptpaymenthandlerv1tov2)
- [adaptPaymentHandlerV2ToV1](#adaptpaymenthandlerv2tov1)
- [isAddress](#isaddress)
- [isPrivateKey](#isprivatekey)
- [narrowHandlers](#narrowhandlers)
- [resolveX402Requirements](#resolvex402requirements)
- [settleX402Payment](#settlex402payment)
- [verifyX402Payment](#verifyx402payment)
- [isBaseAddress](#isbaseaddress)
- [isSolanaCluster](#issolanacluster)
- [isSolanaCAIP2NetworkString](#issolanacaip2networkstring)
- [isSolanaCAIP2Network](#issolanacaip2network)
- [createSolanaNetwork](#createsolananetwork)

### caseInsensitiveLiteral

Creates an arktype validator for case-insensitive string literals.

Input strings are lowercased before matching against the allowed values.

| Function                 | Type                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caseInsensitiveLiteral` | `<T extends string>(...l: T[]) => instantiateType<normalizeMorphDistribution<_inferIntersection<(In: string) => To<string>, Lowercase<T>, true>, _inferIntersection<(In: string) => To<string>, Lowercase<T>, true> extends InferredMorph<...> ? i : never, _inferIntersection<...> extends InferredMorph<...> ? [...] extends...` |

Parameters:

- `l`: - The literal string values to accept (case-insensitive)

Returns:

An arktype validator that accepts any case variant of the literals

### isValidationError

Type guard that checks if a value is an arktype validation error.

| Function            | Type                                                       |
| ------------------- | ---------------------------------------------------------- |
| `isValidationError` | `(possibleErrors: unknown) => possibleErrors is ArkErrors` |

Parameters:

- `possibleErrors`: - The value to check

Returns:

True if the value is a validation error

### throwValidationError

Throws an error with the validation error messages appended.

| Function               | Type                                            |
| ---------------------- | ----------------------------------------------- |
| `throwValidationError` | `(message: string, errors: ArkErrors) => never` |

Parameters:

- `message`: - Context message describing what was being validated
- `errors`: - The arktype validation errors

### normalizePaymentRequiredResponse

Normalize a lenient payment required response to spec-compliant field values.
Defaults error to empty string when missing.

| Function                           | Type                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizePaymentRequiredResponse` | `(res: { x402Version: number; accepts: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }[]; error?: string or undef...` |

### normalizeVerifyResponse

Normalize a lenient verify response to spec-compliant field values.
Defaults payer to empty string and strips null from invalidReason.

| Function                  | Type                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeVerifyResponse` | `(res: { isValid: boolean; invalidReason?: string or null or undefined; payer?: string or undefined; }) => { isValid: boolean; payer: string; invalidReason?: string or undefined; }` |

### normalizeSettleResponse

Normalize a lenient settle response to spec-compliant field names.
Converts legacy field names (txHash, networkId, error) to spec-compliant
names (transaction, network, errorReason).

| Function                  | Type                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeSettleResponse` | `(res: { success: boolean; errorReason?: string or null or undefined; error?: string or null or undefined; transaction?: string or null or undefined; txHash?: string or null or undefined; network?: string or ... 1 more ... or undefined; networkId?: string or ... 1 more ... or undefined; payer?: string or undefined; }) => { ...; }` |

### generateRequirementsMatcher

Creates a matcher function for filtering payment requirements.

The matcher performs case-insensitive matching on scheme, network,
and asset fields.

| Function                      | Type                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateRequirementsMatcher` | `(scheme: string[], network: string[], asset: string[]) => { matchTuple: Type<{ scheme: (In: string) => To<Lowercase<string>>; network: (In: string) => To<Lowercase<string>>; asset: (In: string) => To<...>; }, {}>; isMatchingRequirement: (req: { ...; }) => boolean; }` |

Parameters:

- `scheme`: - Accepted payment scheme names
- `network`: - Accepted network identifiers
- `asset`: - Accepted asset addresses

Returns:

Object with the matcher tuple and isMatchingRequirement function

### adaptRequirementsV1ToV2

Converts v1 payment requirements to v2 format.

| Function                  | Type                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptRequirementsV1ToV2` | `(req: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }, translateNetwork: NetworkTranslator) => { ...; }` |

Parameters:

- `req`: - The v1 payment requirements
- `translateNetwork`: - Function to translate legacy network IDs to CAIP-2

Returns:

The v2 payment requirements

### adaptRequirementsV2ToV1

Converts v2 payment requirements to v1 format.

| Function                  | Type                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adaptRequirementsV2ToV1` | `(req: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }, resource: { url: string; description?: string or undefined; mimeType?: string or undefined; }, translateNetwork?: NetworkTranslator or undefined) => { ...; } and { ...; }` |

Parameters:

- `req`: - The v2 payment requirements
- `resource`: - Resource information to populate v1 fields
- `translateNetwork`: - Optional function to translate CAIP-2 to legacy IDs

Returns:

The v1 payment requirements with mimeType guaranteed

### extractResourceInfoV1

Extracts resource information from v1 payment requirements.

| Function                | Type                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractResourceInfoV1` | `(req: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }) => { ...; }` |

Parameters:

- `req`: - The v1 payment requirements containing resource fields

Returns:

The extracted resource information

### adaptPayloadV1ToV2

Converts a v1 payment payload to v2 format.

| Function             | Type                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptPayloadV1ToV2` | `(payload: { x402Version: number; scheme: string; network: string; payload: object; asset?: string or undefined; }, requirements: { scheme: string; network: string; maxAmountRequired: string; resource: string; ... 6 more ...; extra?: object or undefined; }, translateNetwork: NetworkTranslator) => { ...; }` |

Parameters:

- `payload`: - The v1 payment payload
- `requirements`: - The v1 requirements used for resource extraction
- `translateNetwork`: - Function to translate legacy network IDs to CAIP-2

Returns:

The v2 payment payload

### adaptPaymentRequiredResponseV1ToV2

Converts a v1 payment required response to v2 format.

| Function                             | Type                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptPaymentRequiredResponseV1ToV2` | `(v1Response: { x402Version: number; accepts: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }[]; error?: string ...` |

Parameters:

- `v1Response`: - The v1 payment required response
- `resourceURL`: - The URL of the protected resource
- `translateNetwork`: - Function to translate legacy network IDs to CAIP-2

Returns:

The v2 payment required response

### adaptPaymentRequiredResponseV2ToV1

Converts a v2 payment required response to v1 format.

| Function                             | Type                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptPaymentRequiredResponseV2ToV1` | `(v2Response: { x402Version: 2; resource: { url: string; description?: string or undefined; mimeType?: string or undefined; }; accepts: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }[]; error?: string or undefined; extensions?: ob...` |

Parameters:

- `v2Response`: - The v2 payment required response
- `translateNetwork`: - Optional function to translate CAIP-2 to legacy IDs

Returns:

The v1 payment required response

### adaptVerifyResponseV2ToV1

Converts a v2 verify response to v1 format.

| Function                    | Type                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptVerifyResponseV2ToV1` | `(res: { isValid: boolean; invalidReason?: string or undefined; payer?: string or undefined; }) => { isValid: boolean; payer: string; invalidReason?: string or undefined; }` |

Parameters:

- `res`: - The v2 verify response

Returns:

The v1 verify response

### adaptVerifyResponseV1ToV2

Converts a v1 verify response to v2 format.

| Function                    | Type                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptVerifyResponseV1ToV2` | `(res: { isValid: boolean; invalidReason?: string or null or undefined; payer?: string or undefined; }) => { isValid: boolean; invalidReason?: string or undefined; payer?: string or undefined; }` |

Parameters:

- `res`: - The v1 verify response (lenient)

Returns:

The v2 verify response

### adaptSettleResponseV2ToV1

Adapt v2 settle response to spec-compliant v1 format.
Since v1 spec uses the same field names as v2 (transaction, network, errorReason),
this is primarily a network translation pass.

| Function                    | Type                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSettleResponseV2ToV1` | `(res: { success: boolean; transaction: string; network: string; errorReason?: string or undefined; payer?: string or undefined; extensions?: object or undefined; }, translateNetwork?: NetworkTranslator or undefined) => { ...; }` |

### adaptSettleResponseV2ToV1Legacy

Adapt v2 settle response to legacy v1 format with old field names.
Use this only for backward compatibility with clients expecting
txHash/networkId/error field names.

| Function                          | Type                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSettleResponseV2ToV1Legacy` | `(res: { success: boolean; transaction: string; network: string; errorReason?: string or undefined; payer?: string or undefined; extensions?: object or undefined; }, translateNetwork?: NetworkTranslator or undefined) => { ...; }` |

### adaptSettleResponseV1ToV2

Adapt v1 settle response to v2 format.
Accepts lenient input that may have optional/nullable fields from older handlers.

| Function                    | Type                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSettleResponseV1ToV2` | `(res: { success: boolean; errorReason?: string or null or undefined; error?: string or null or undefined; transaction?: string or null or undefined; txHash?: string or null or undefined; network?: string or ... 1 more ... or undefined; networkId?: string or ... 1 more ... or undefined; payer?: string or undefined; }) => { ...; }` |

### adaptSettleResponseLegacyToV2

Adapt legacy v1 settle response (with txHash/networkId/error) to v2 format.
Use this when receiving data from older clients that use legacy field names.

| Function                        | Type                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSettleResponseLegacyToV2` | `(res: { success: boolean; txHash: string or null; networkId: string or null; error?: string or null or undefined; payer?: string or undefined; }) => { success: boolean; transaction: string; network: string; errorReason?: string or undefined; payer?: string or undefined; extensions?: object or undefined; }` |

### adaptSettleResponseLenientToV2

Adapt a lenient v1 settle response (accepting either legacy or spec-compliant
field names) to v2 format. This is the most flexible adapter for parsing
incoming settle responses from unknown sources.

| Function                         | Type                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSettleResponseLenientToV2` | `(res: { success: boolean; errorReason?: string or null or undefined; error?: string or null or undefined; transaction?: string or null or undefined; txHash?: string or null or undefined; network?: string or ... 1 more ... or undefined; networkId?: string or ... 1 more ... or undefined; payer?: string or undefined; }) => { ...; }` |

### adaptSupportedKindV2ToV1

Converts a v2 supported kind to v1 format.

| Function                   | Type                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSupportedKindV2ToV1` | `(kind: { x402Version: 2; scheme: string; network: string; extra?: object or undefined; }, translateNetwork?: NetworkTranslator or undefined) => { x402Version: 1 or 2; scheme: string; network: string; extra?: object or undefined; }` |

Parameters:

- `kind`: - The v2 supported kind
- `translateNetwork`: - Optional function to translate CAIP-2 to legacy IDs

Returns:

The v1 supported kind

### adaptSupportedKindV1ToV2

Converts a v1 supported kind to v2 format.

| Function                   | Type                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adaptSupportedKindV1ToV2` | `(kind: { x402Version: number; scheme: string; network: string; extra?: object or undefined; }, translateNetwork: NetworkTranslator) => { x402Version: 2; scheme: string; network: string; extra?: object or undefined; }` |

Parameters:

- `kind`: - The v1 supported kind
- `translateNetwork`: - Function to translate legacy network IDs to CAIP-2

Returns:

The v2 supported kind

### adaptPaymentHandlerV1ToV2

Adapt a v1 PaymentHandlerV1 to the PaymentHandler interface.

This allows existing v1 payment handlers to be used with v2 infrastructure.
Requirements are converted from v2 to v1 before being passed to the handler,
and the resulting execers are wrapped to convert requirements back to v2.

Accepts both spec-compliant handlers (with optional mimeType) and legacy
handlers (with required mimeType) for backwards compatibility.

| Function                    | Type                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `adaptPaymentHandlerV1ToV2` | `(handler: PaymentHandlerV1 or PaymentHandlerV1Strict, translateNetwork: NetworkTranslator) => PaymentHandler` |

Parameters:

- `handler`: - The v1 payment handler to adapt
- `translateNetwork`: - Function to translate legacy network IDs to CAIP-2

### adaptPaymentHandlerV2ToV1

Adapt a PaymentHandler to the v1 PaymentHandlerV1 interface.

This allows v2 payment handlers to be used with v1 infrastructure.

| Function                    | Type                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `adaptPaymentHandlerV2ToV1` | `(handler: PaymentHandler, translateNetwork: NetworkTranslator) => PaymentHandlerV1` |

Parameters:

- `handler`: - The v2 payment handler to adapt
- `translateNetwork`: - Function to translate legacy network IDs to CAIP-2

### isAddress

Type guard that checks if a value is a valid EVM address.

| Function    | Type                                         |
| ----------- | -------------------------------------------- |
| `isAddress` | `(maybe: unknown) => maybe is `0x${string}`` |

Parameters:

- `maybe`: - The value to check

Returns:

True if the value matches the EVM address format

### isPrivateKey

Type guard that checks if a value is a valid EVM private key.

| Function       | Type                                         |
| -------------- | -------------------------------------------- |
| `isPrivateKey` | `(maybe: unknown) => maybe is `0x${string}`` |

Parameters:

- `maybe`: - The value to check

Returns:

True if the value matches the private key format

### narrowHandlers

Returns handlers whose capabilities match the given network and asset.
Handlers without capabilities are excluded.

Empty `networks` or `assets` arrays act as wildcards (match everything).
This supports the HTTP handler backward-compat path where the handler
delegates all routing to the remote facilitator.

| Function         | Type                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `narrowHandlers` | `(handlers: FacilitatorHandler[], criteria: { network: string; asset: string; }) => FacilitatorHandler[]` |

### resolveX402Requirements

Converts {@link ResourcePricing} entries into enriched
{@link x402PaymentRequirements} by routing through handlers.

For each handler with capabilities, matches pricing entries by network
and asset, constructs skeletal x402 requirements using the handler's
declared schemes, then calls `handler.getRequirements()` to enrich
them with protocol-specific fields (extras, timeouts, etc.).

Handlers without capabilities are skipped. If a handler throws,
the exception propagates to the caller.

| Function                  | Type                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolveX402Requirements` | `(handlers: FacilitatorHandler[], pricing: ResourcePricing[], resource: string, opts?: ResolveOpts or undefined) => Promise<{ scheme: string; ... 5 more ...; extra?: object or undefined; }[]>` |

### settleX402Payment

Routes a settlement request to the appropriate handler.

Narrows handlers by capabilities (network + asset), then iterates
`handleSettle` until one returns a non-null result. If a handler
throws, the exception propagates immediately.

| Function            | Type                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settleX402Payment` | `(handlers: FacilitatorHandler[], requirements: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }, payment: { ...; }) => Promise<...>` |

### verifyX402Payment

Routes a verification request to the appropriate handler.

Same pattern as {@link settleX402Payment} but calls `handleVerify`.
Handlers without `handleVerify` are skipped.

| Function            | Type                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifyX402Payment` | `(handlers: FacilitatorHandler[], requirements: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }, payment: { ...; }) => Promise<...>` |

### isBaseAddress

Type guard that checks if a value is a valid Solana base58 address.

| Function        | Type                                  |
| --------------- | ------------------------------------- |
| `isBaseAddress` | `(maybe: unknown) => maybe is string` |

Parameters:

- `maybe`: - The value to check

Returns:

True if the value matches the base58 address format

### isSolanaCluster

Type guard that checks if a value is a valid Solana cluster name.

| Function          | Type                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `isSolanaCluster` | `(maybe: unknown) => maybe is "mainnet-beta" or "devnet" or "testnet"` |

Parameters:

- `maybe`: - The value to check

Returns:

True if the value is a known cluster name

### isSolanaCAIP2NetworkString

Type guard that checks if a value is a valid Solana CAIP-2 network string.

| Function                     | Type                                  |
| ---------------------------- | ------------------------------------- |
| `isSolanaCAIP2NetworkString` | `(maybe: unknown) => maybe is string` |

Parameters:

- `maybe`: - The value to check

Returns:

True if the value matches the Solana CAIP-2 format

### isSolanaCAIP2Network

Type guard that checks if a value is a SolanaCAIP2Network object.

| Function               | Type                                              |
| ---------------------- | ------------------------------------------------- |
| `isSolanaCAIP2Network` | `(maybe: unknown) => maybe is SolanaCAIP2Network` |

Parameters:

- `maybe`: - The value to check

Returns:

True if the value is a SolanaCAIP2Network object

### createSolanaNetwork

Creates a SolanaCAIP2Network object from a CAIP-2 string.

| Function              | Type                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `createSolanaNetwork` | `(caip2: string, name?: string or undefined) => SolanaCAIP2Network` |

Parameters:

- `caip2`: - The CAIP-2 network identifier string (e.g., "solana:5eykt...")
- `name`: - Optional display name for the network

Returns:

A SolanaCAIP2Network object

## Constants

- [X_PAYMENT_HEADER](#x_payment_header)
- [X_PAYMENT_RESPONSE_HEADER](#x_payment_response_header)
- [x402PaymentId](#x402paymentid)
- [x402PaymentRequirements](#x402paymentrequirements)
- [x402PaymentRequiredResponse](#x402paymentrequiredresponse)
- [x402PaymentRequiredResponseLenient](#x402paymentrequiredresponselenient)
- [x402PaymentPayload](#x402paymentpayload)
- [x402PaymentHeaderToPayload](#x402paymentheadertopayload)
- [x402VerifyRequest](#x402verifyrequest)
- [x402VerifyResponse](#x402verifyresponse)
- [x402VerifyResponseLenient](#x402verifyresponselenient)
- [x402SettleRequest](#x402settlerequest)
- [x402SettleResponseLegacy](#x402settleresponselegacy)
- [x402SettleResponse](#x402settleresponse)
- [x402SettleResponseLenient](#x402settleresponselenient)
- [x402SupportedKind](#x402supportedkind)
- [x402SupportedResponse](#x402supportedresponse)
- [V2_PAYMENT_HEADER](#v2_payment_header)
- [V2_PAYMENT_REQUIRED_HEADER](#v2_payment_required_header)
- [V2_PAYMENT_RESPONSE_HEADER](#v2_payment_response_header)
- [x402ResourceInfo](#x402resourceinfo)
- [x402PaymentRequirements](#x402paymentrequirements)
- [x402PaymentRequiredResponse](#x402paymentrequiredresponse)
- [x402PaymentPayload](#x402paymentpayload)
- [x402PaymentHeaderToPayload](#x402paymentheadertopayload)
- [x402VerifyRequest](#x402verifyrequest)
- [x402VerifyResponse](#x402verifyresponse)
- [x402SettleRequest](#x402settlerequest)
- [x402SettleResponse](#x402settleresponse)
- [x402SupportedKind](#x402supportedkind)
- [x402SupportedKindAny](#x402supportedkindany)
- [x402SupportedResponse](#x402supportedresponse)
- [Address](#address)
- [PrivateKey](#privatekey)
- [Base58Address](#base58address)
- [SolanaCluster](#solanacluster)
- [SolanaCAIP2NetworkString](#solanacaip2networkstring)

### X_PAYMENT_HEADER

HTTP header name for v1 client payment payloads.

| Constant           | Type          |
| ------------------ | ------------- |
| `X_PAYMENT_HEADER` | `"X-PAYMENT"` |

### X_PAYMENT_RESPONSE_HEADER

HTTP header name for v1 server payment responses.

| Constant                    | Type                   |
| --------------------------- | ---------------------- |
| `X_PAYMENT_RESPONSE_HEADER` | `"X-PAYMENT-RESPONSE"` |

### x402PaymentId

| Constant        | Type                                                            |
| --------------- | --------------------------------------------------------------- |
| `x402PaymentId` | `Type<{ scheme: string; network: string; asset: string; }, {}>` |

### x402PaymentRequirements

| Constant                  | Type                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentRequirements` | `Type<{ scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }, {}>` |

### x402PaymentRequiredResponse

| Constant                      | Type                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentRequiredResponse` | `Type<{ x402Version: number; accepts: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }[]; error: string; }, {}>` |

### x402PaymentRequiredResponseLenient

Lenient payment required response parser that accepts optional error field.
Use this when parsing incoming data from older servers that may not include
the error field.

| Constant                             | Type                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentRequiredResponseLenient` | `Type<{ x402Version: number; accepts: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }[]; error?: string or undefi...` |

### x402PaymentPayload

| Constant             | Type                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentPayload` | `Type<{ x402Version: number; scheme: string; network: string; payload: object; asset?: string or undefined; }, {}>` |

### x402PaymentHeaderToPayload

| Constant                     | Type                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentHeaderToPayload` | `Type<(In: string) => To<{ x402Version: number; scheme: string; network: string; payload: object; asset?: string or undefined; }>, {}>` |

### x402VerifyRequest

| Constant            | Type                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402VerifyRequest` | `Type<{ paymentRequirements: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }; paymentHeader?: string or undefined...` |

### x402VerifyResponse

| Constant             | Type                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `x402VerifyResponse` | `Type<{ isValid: boolean; payer: string; invalidReason?: string or undefined; }, {}>` |

### x402VerifyResponseLenient

Lenient verify response parser that accepts optional payer field.
Use this when parsing incoming data from older facilitators that may
not include the payer field.

| Constant                    | Type                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `x402VerifyResponseLenient` | `Type<{ isValid: boolean; invalidReason?: string or null or undefined; payer?: string or undefined; }, {}>` |

### x402SettleRequest

| Constant            | Type                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402SettleRequest` | `Type<{ paymentRequirements: { scheme: string; network: string; maxAmountRequired: string; resource: string; description: string; payTo: string; maxTimeoutSeconds: number; asset: string; mimeType?: string or undefined; outputSchema?: object or undefined; extra?: object or undefined; }; paymentHeader?: string or undefined...` |

### x402SettleResponseLegacy

Legacy settle response type with pre-spec field names (txHash, networkId, error).
Use x402SettleResponse for spec-compliant field names (transaction, network, errorReason).

This type exists for backward compatibility when interfacing with older clients
that use legacy field names.

| Constant                   | Type                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `x402SettleResponseLegacy` | `Type<{ success: boolean; txHash: string or null; networkId: string or null; error?: string or null or undefined; payer?: string or undefined; }, {}>` |

### x402SettleResponse

Spec-compliant settle response per x402-specification-v1.md Section 5.3.
Field names: transaction, network, errorReason (not txHash, networkId, error)

| Constant             | Type                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `x402SettleResponse` | `Type<{ success: boolean; transaction: string; network: string; payer: string; errorReason?: string or undefined; }, {}>` |

### x402SettleResponseLenient

Lenient settle response parser that accepts either legacy or spec-compliant
field names. Use this when parsing incoming data that may come from older
clients using legacy field names.

| Constant                    | Type                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402SettleResponseLenient` | `Type<{ success: boolean; errorReason?: string or null or undefined; error?: string or null or undefined; transaction?: string or null or undefined; txHash?: string or null or undefined; network?: string or ... 1 more ... or undefined; networkId?: string or ... 1 more ... or undefined; payer?: string or undefined; }, {}>` |

### x402SupportedKind

| Constant            | Type                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `x402SupportedKind` | `Type<{ x402Version: number; scheme: string; network: string; extra?: object or undefined; }, {}>` |

### x402SupportedResponse

| Constant                | Type                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `x402SupportedResponse` | `Type<{ kinds: { x402Version: number; scheme: string; network: string; extra?: object or undefined; }[]; }, {}>` |

### V2_PAYMENT_HEADER

HTTP header name for v2 client payment signatures.

| Constant            | Type                  |
| ------------------- | --------------------- |
| `V2_PAYMENT_HEADER` | `"PAYMENT-SIGNATURE"` |

### V2_PAYMENT_REQUIRED_HEADER

HTTP header name for v2 402 payment required responses.

| Constant                     | Type                 |
| ---------------------------- | -------------------- |
| `V2_PAYMENT_REQUIRED_HEADER` | `"PAYMENT-REQUIRED"` |

### V2_PAYMENT_RESPONSE_HEADER

HTTP header name for v2 server payment responses.

| Constant                     | Type                 |
| ---------------------------- | -------------------- |
| `V2_PAYMENT_RESPONSE_HEADER` | `"PAYMENT-RESPONSE"` |

### x402ResourceInfo

| Constant           | Type                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `x402ResourceInfo` | `Type<{ url: string; description?: string or undefined; mimeType?: string or undefined; }, {}>` |

### x402PaymentRequirements

| Constant                  | Type                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `x402PaymentRequirements` | `Type<{ scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }, {}>` |

### x402PaymentRequiredResponse

| Constant                      | Type                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentRequiredResponse` | `Type<{ x402Version: 2; resource: { url: string; description?: string or undefined; mimeType?: string or undefined; }; accepts: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }[]; error?: string or undefined; extensions?: object or u...` |

### x402PaymentPayload

| Constant             | Type                                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentPayload` | `Type<{ x402Version: 2; accepted: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }; payload: object; resource?: { ...; } or undefined; extensions?: object or undefined; }, {}>` |

### x402PaymentHeaderToPayload

| Constant                     | Type                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402PaymentHeaderToPayload` | `Type<(In: string) => To<{ x402Version: 2; accepted: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }; payload: object; resource?: { ...; } or undefined; extensions?: object or undefined; }>, {}>` |

### x402VerifyRequest

| Constant            | Type                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `x402VerifyRequest` | `Type<{ paymentPayload: { x402Version: 2; accepted: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }; payload: object; resource?: { ...; } or undefined; extensions?: object or undefined; }; paymentRequirements: { ...; }; }, {}>` |

### x402VerifyResponse

| Constant             | Type                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `x402VerifyResponse` | `Type<{ isValid: boolean; invalidReason?: string or undefined; payer?: string or undefined; }, {}>` |

### x402SettleRequest

| Constant            | Type                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `x402SettleRequest` | `Type<{ paymentPayload: { x402Version: 2; accepted: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }; payload: object; resource?: { ...; } or undefined; extensions?: object or undefined; }; paymentRequirements: { ...; }; }, {}>` |

### x402SettleResponse

| Constant             | Type                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402SettleResponse` | `Type<{ success: boolean; transaction: string; network: string; errorReason?: string or undefined; payer?: string or undefined; extensions?: object or undefined; }, {}>` |

### x402SupportedKind

| Constant            | Type                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `x402SupportedKind` | `Type<{ x402Version: 2; scheme: string; network: string; extra?: object or undefined; }, {}>` |

### x402SupportedKindAny

| Constant               | Type                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `x402SupportedKindAny` | `Type<{ x402Version: 1 or 2; scheme: string; network: string; extra?: object or undefined; }, {}>` |

### x402SupportedResponse

| Constant                | Type                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x402SupportedResponse` | `Type<{ kinds: { x402Version: 1 or 2; scheme: string; network: string; extra?: object or undefined; }[]; extensions: string[]; signers: Record<string, string[]>; }, {}>` |

### Address

Validator for EVM hex addresses (40 hex characters, optional 0x prefix).

| Constant  | Type                      |
| --------- | ------------------------- |
| `Address` | `Type<`0x${string}`, {}>` |

### PrivateKey

Validator for EVM private keys (64 hex characters with 0x prefix).

| Constant     | Type                      |
| ------------ | ------------------------- |
| `PrivateKey` | `Type<`0x${string}`, {}>` |

### Base58Address

Validator for Solana base58-encoded addresses.

| Constant        | Type               |
| --------------- | ------------------ |
| `Base58Address` | `Type<string, {}>` |

### SolanaCluster

Validator for Solana cluster names.

| Constant        | Type                                                |
| --------------- | --------------------------------------------------- |
| `SolanaCluster` | `Type<"mainnet-beta" or "devnet" or "testnet", {}>` |

### SolanaCAIP2NetworkString

Validator for Solana CAIP-2 network identifier strings.

Format: solana:<genesis-hash> where genesis-hash is base58-encoded.

| Constant                   | Type               |
| -------------------------- | ------------------ |
| `SolanaCAIP2NetworkString` | `Type<string, {}>` |

## Interfaces

- [GetRequirementsArgs](#getrequirementsargs)
- [FacilitatorHandler](#facilitatorhandler)

### GetRequirementsArgs

Arguments passed to the facilitator's getRequirements method.

| Property   | Type                                                                                                                                           | Description                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `accepts`  | `{ scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }[]` | Payment requirements the server is willing to accept    |
| `resource` | `{ url: string; description?: string or undefined; mimeType?: string or undefined; } or undefined`                                             | Optional resource information for the protected content |

### FacilitatorHandler

Handler interface implemented by payment scheme facilitators.

Each method returns null when the request doesn't match the handler's
payment scheme, allowing multiple handlers to be composed.

| Property          | Type                                                                                                                                                                                                                                                                                                                                  | Description                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `capabilities`    | `HandlerCapabilities or undefined`                                                                                                                                                                                                                                                                                                    | Declares what this handler can settle. Required for in-process usage. |
| `getSupported`    | `(() => Promise<{ x402Version: 2; scheme: string; network: string; extra?: object or undefined; }>[]) or undefined`                                                                                                                                                                                                                   | Returns the payment schemes this handler supports                     |
| `getRequirements` | `(args: GetRequirementsArgs) => Promise<{ scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }[]>`                                                                                                                                                | Filters and enriches payment requirements this handler can process    |
| `handleVerify`    | `((requirements: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }, payment: { x402Version: 2; accepted: { scheme: string; ... 5 more ...; extra?: object or undefined; }; payload: object; resource?: { ...; } or undefined; extensions...` | Verifies a payment without settling it (optional)                     |
| `handleSettle`    | `(requirements: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: object or undefined; }, payment: { x402Version: 2; accepted: { scheme: string; ... 5 more ...; extra?: object or undefined; }; payload: object; resource?: { ...; } or undefined; extensions?...` | Settles a payment by executing the on-chain transaction               |
| `getSigners`      | `(() => Promise<Record<string, string[]>>) or undefined`                                                                                                                                                                                                                                                                              | Returns signer addresses organized by network (optional)              |

## Types

- [x402PaymentId](#x402paymentid)
- [x402PaymentRequirements](#x402paymentrequirements)
- [x402PaymentRequiredResponse](#x402paymentrequiredresponse)
- [x402PaymentRequiredResponseLenient](#x402paymentrequiredresponselenient)
- [x402PaymentPayload](#x402paymentpayload)
- [x402VerifyRequest](#x402verifyrequest)
- [x402VerifyResponse](#x402verifyresponse)
- [x402VerifyResponseLenient](#x402verifyresponselenient)
- [x402SettleRequest](#x402settlerequest)
- [x402SettleResponseLegacy](#x402settleresponselegacy)
- [x402SettleResponse](#x402settleresponse)
- [x402SettleResponseLenient](#x402settleresponselenient)
- [x402SupportedKind](#x402supportedkind)
- [x402SupportedResponse](#x402supportedresponse)
- [x402ResourceInfo](#x402resourceinfo)
- [x402PaymentRequirements](#x402paymentrequirements)
- [x402PaymentRequiredResponse](#x402paymentrequiredresponse)
- [x402PaymentPayload](#x402paymentpayload)
- [x402VerifyRequest](#x402verifyrequest)
- [x402VerifyResponse](#x402verifyresponse)
- [x402SettleRequest](#x402settlerequest)
- [x402SettleResponse](#x402settleresponse)
- [x402SupportedKind](#x402supportedkind)
- [x402SupportedKindAny](#x402supportedkindany)
- [x402SupportedResponse](#x402supportedresponse)
- [NetworkTranslator](#networktranslator)
- [RequestContext](#requestcontext)
- [PaymentExecResult](#paymentexecresult)
- [PaymentExecer](#paymentexecer)
- [PaymentHandler](#paymenthandler)
- [PaymentExecerV1](#paymentexecerv1)
- [PaymentHandlerV1](#paymenthandlerv1)
- [Address](#address)
- [PrivateKey](#privatekey)
- [ChainInfo](#chaininfo)
- [ChainInfoWithRPC](#chaininfowithrpc)
- [ResourcePricing](#resourcepricing)
- [HandlerCapabilities](#handlercapabilities)
- [Base58Address](#base58address)
- [SolanaCluster](#solanacluster)
- [SolanaCAIP2Network](#solanacaip2network)

### x402PaymentId

| Type            | Type                         |
| --------------- | ---------------------------- |
| `x402PaymentId` | `typeof x402PaymentId.infer` |

### x402PaymentRequirements

| Type                      | Type                                   |
| ------------------------- | -------------------------------------- |
| `x402PaymentRequirements` | `typeof x402PaymentRequirements.infer` |

### x402PaymentRequiredResponse

| Type                          | Type                                       |
| ----------------------------- | ------------------------------------------ |
| `x402PaymentRequiredResponse` | `typeof x402PaymentRequiredResponse.infer` |

### x402PaymentRequiredResponseLenient

Lenient payment required response parser that accepts optional error field.
Use this when parsing incoming data from older servers that may not include
the error field.

| Type                                 | Type                                              |
| ------------------------------------ | ------------------------------------------------- |
| `x402PaymentRequiredResponseLenient` | `typeof x402PaymentRequiredResponseLenient.infer` |

### x402PaymentPayload

| Type                 | Type                              |
| -------------------- | --------------------------------- |
| `x402PaymentPayload` | `typeof x402PaymentPayload.infer` |

### x402VerifyRequest

| Type                | Type                             |
| ------------------- | -------------------------------- |
| `x402VerifyRequest` | `typeof x402VerifyRequest.infer` |

### x402VerifyResponse

| Type                 | Type                              |
| -------------------- | --------------------------------- |
| `x402VerifyResponse` | `typeof x402VerifyResponse.infer` |

### x402VerifyResponseLenient

Lenient verify response parser that accepts optional payer field.
Use this when parsing incoming data from older facilitators that may
not include the payer field.

| Type                        | Type                                     |
| --------------------------- | ---------------------------------------- |
| `x402VerifyResponseLenient` | `typeof x402VerifyResponseLenient.infer` |

### x402SettleRequest

| Type                | Type                             |
| ------------------- | -------------------------------- |
| `x402SettleRequest` | `typeof x402SettleRequest.infer` |

### x402SettleResponseLegacy

Legacy settle response type with pre-spec field names (txHash, networkId, error).
Use x402SettleResponse for spec-compliant field names (transaction, network, errorReason).

This type exists for backward compatibility when interfacing with older clients
that use legacy field names.

| Type                       | Type                                    |
| -------------------------- | --------------------------------------- |
| `x402SettleResponseLegacy` | `typeof x402SettleResponseLegacy.infer` |

### x402SettleResponse

Spec-compliant settle response per x402-specification-v1.md Section 5.3.
Field names: transaction, network, errorReason (not txHash, networkId, error)

| Type                 | Type                              |
| -------------------- | --------------------------------- |
| `x402SettleResponse` | `typeof x402SettleResponse.infer` |

### x402SettleResponseLenient

Lenient settle response parser that accepts either legacy or spec-compliant
field names. Use this when parsing incoming data that may come from older
clients using legacy field names.

| Type                        | Type                                     |
| --------------------------- | ---------------------------------------- |
| `x402SettleResponseLenient` | `typeof x402SettleResponseLenient.infer` |

### x402SupportedKind

| Type                | Type                             |
| ------------------- | -------------------------------- |
| `x402SupportedKind` | `typeof x402SupportedKind.infer` |

### x402SupportedResponse

| Type                    | Type                                 |
| ----------------------- | ------------------------------------ |
| `x402SupportedResponse` | `typeof x402SupportedResponse.infer` |

### x402ResourceInfo

| Type               | Type                            |
| ------------------ | ------------------------------- |
| `x402ResourceInfo` | `typeof x402ResourceInfo.infer` |

### x402PaymentRequirements

| Type                      | Type                                   |
| ------------------------- | -------------------------------------- |
| `x402PaymentRequirements` | `typeof x402PaymentRequirements.infer` |

### x402PaymentRequiredResponse

| Type                          | Type                                       |
| ----------------------------- | ------------------------------------------ |
| `x402PaymentRequiredResponse` | `typeof x402PaymentRequiredResponse.infer` |

### x402PaymentPayload

| Type                 | Type                              |
| -------------------- | --------------------------------- |
| `x402PaymentPayload` | `typeof x402PaymentPayload.infer` |

### x402VerifyRequest

| Type                | Type                             |
| ------------------- | -------------------------------- |
| `x402VerifyRequest` | `typeof x402VerifyRequest.infer` |

### x402VerifyResponse

| Type                 | Type                              |
| -------------------- | --------------------------------- |
| `x402VerifyResponse` | `typeof x402VerifyResponse.infer` |

### x402SettleRequest

| Type                | Type                             |
| ------------------- | -------------------------------- |
| `x402SettleRequest` | `typeof x402SettleRequest.infer` |

### x402SettleResponse

| Type                 | Type                              |
| -------------------- | --------------------------------- |
| `x402SettleResponse` | `typeof x402SettleResponse.infer` |

### x402SupportedKind

| Type                | Type                             |
| ------------------- | -------------------------------- |
| `x402SupportedKind` | `typeof x402SupportedKind.infer` |

### x402SupportedKindAny

| Type                   | Type                                |
| ---------------------- | ----------------------------------- |
| `x402SupportedKindAny` | `typeof x402SupportedKindAny.infer` |

### x402SupportedResponse

| Type                    | Type                                 |
| ----------------------- | ------------------------------------ |
| `x402SupportedResponse` | `typeof x402SupportedResponse.infer` |

### NetworkTranslator

Callback for translating network identifiers between formats.

For v1→v2 adapters: translates legacy network names to CAIP-2 identifiers.
For v2→v1 adapters: translates CAIP-2 identifiers to legacy network names.

Returns the translated network identifier, or the input unchanged if
no translation is available.

| Type                | Type                          |
| ------------------- | ----------------------------- |
| `NetworkTranslator` | `(network: string) => string` |

### RequestContext

| Type             | Type                               |
| ---------------- | ---------------------------------- |
| `RequestContext` | `{ request: RequestInfo or URL; }` |

### PaymentExecResult

| Type                | Type                   |
| ------------------- | ---------------------- |
| `PaymentExecResult` | `{ payload: object; }` |

### PaymentExecer

Payment execer - the primary interface for payment execution.
Uses requirements with the `amount` field.

| Type            | Type                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| `PaymentExecer` | `{ requirements: x402PaymentRequirements; exec(): Promise<PaymentExecResult>; }` |

### PaymentHandler

Payment handler - the primary interface for payment handlers.
Receives requirements and returns execers.

| Type             | Type                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `PaymentHandler` | `( context: RequestContext, accepts: x402PaymentRequirements[], ) => Promise<PaymentExecer[]>` |

### PaymentExecerV1

| Type              | Type                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `PaymentExecerV1` | `{ requirements: x402PaymentRequirementsV1; exec(): Promise<PaymentExecResult>; }` |

### PaymentHandlerV1

| Type               | Type                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `PaymentHandlerV1` | `( context: RequestContext, accepts: x402PaymentRequirementsV1[], ) => Promise<PaymentExecerV1[]>` |

### Address

Validator for EVM hex addresses (40 hex characters, optional 0x prefix).

| Type      | Type                   |
| --------- | ---------------------- |
| `Address` | `typeof Address.infer` |

### PrivateKey

Validator for EVM private keys (64 hex characters with 0x prefix).

| Type         | Type                   |
| ------------ | ---------------------- |
| `PrivateKey` | `typeof Address.infer` |

### ChainInfo

| Type        | Type                            |
| ----------- | ------------------------------- |
| `ChainInfo` | `{ id: number; name: string; }` |

### ChainInfoWithRPC

| Type               | Type                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `ChainInfoWithRPC` | `ChainInfo and { rpcUrls: { default: { http: readonly [string]; }; }; }` |

### ResourcePricing

Protocol-agnostic pricing configuration for a protected resource.

This is the resource server's statement of "I want X amount of Y asset
paid to Z recipient on W network." It says nothing about x402 schemes,
MPP methods, or protocol extras -- those are handler output, not
middleware input.

| Type              | Type                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `ResourcePricing` | `{ amount: string; asset: string; recipient: string; network: string; description?: string; }` |

### HandlerCapabilities

Declares what a handler can settle so the middleware can route
{@link ResourcePricing} entries without calling the handler.

Used by both x402 `FacilitatorHandler` (optional) and MPP
`MPPMethodHandler` (required).

`schemes` is x402-specific -- MPP handlers do not use it.

| Type                  | Type                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `HandlerCapabilities` | `{ /** x402-specific. MPP handlers leave this empty or omit it. */ schemes?: string[]; networks: string[]; assets: string[]; }` |

### Base58Address

Validator for Solana base58-encoded addresses.

| Type            | Type                         |
| --------------- | ---------------------------- |
| `Base58Address` | `typeof Base58Address.infer` |

### SolanaCluster

Validator for Solana cluster names.

| Type            | Type                         |
| --------------- | ---------------------------- |
| `SolanaCluster` | `typeof SolanaCluster.infer` |

### SolanaCAIP2Network

Solana network identifier with associated metadata.

| Type                 | Type                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `SolanaCAIP2Network` | `{ readonly hash: string; readonly name?: string; readonly caip2: string; }` |

<!-- TSDOC_END -->

## License

LGPL-3.0-only
