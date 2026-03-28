# @faremeter/facilitator

Facilitator server implementation for x402 protocol payment settlement and validation.

## Installation

```bash
pnpm install @faremeter/facilitator
```

## Features

- Multi-chain support
- Standard x402 endpoints
- Payment verification
- Blockchain settlement

## API Reference

<!-- TSDOC_START -->

## Functions

- [adaptHandlerV1ToV2](#adapthandlerv1tov2)
- [getClientIP](#getclientip)
- [createFacilitatorRoutes](#createfacilitatorroutes)

### adaptHandlerV1ToV2

Adapts a v1 FacilitatorHandler to the v2 interface.
Use this to wrap handlers from external packages that haven't been updated to v2 types.

| Function             | Type                                                        |
| -------------------- | ----------------------------------------------------------- |
| `adaptHandlerV1ToV2` | `(handler: LegacyFacilitatorHandler) => FacilitatorHandler` |

### getClientIP

| Function      | Type                                                |
| ------------- | --------------------------------------------------- |
| `getClientIP` | `(c: Context<any, any, {}>) => string or undefined` |

### createFacilitatorRoutes

Creates a Hono router with x402 facilitator endpoints.

The router provides the following endpoints:

- POST /verify - Verify a payment without settling
- POST /settle - Verify and settle a payment
- POST /accepts - Get payment requirements for a resource
- GET /supported - List supported payment schemes and networks

Both v1 and v2 protocol formats are supported on all endpoints.

| Function                  | Type                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `createFacilitatorRoutes` | `(args: CreateFacilitatorRoutesArgs) => Hono<BlankEnv, BlankSchema, "/">` |

Parameters:

- `args`: - Configuration including payment handlers and timeouts

Returns:

A Hono router instance with facilitator endpoints

## Types

- [LegacyFacilitatorHandler](#legacyfacilitatorhandler)

### LegacyFacilitatorHandler

Legacy facilitator handler interface using pre-spec field names.
Use this to wrap old handlers that return txHash/networkId/error.

| Type                       | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LegacyFacilitatorHandler` | `{ getSupported?: () => Promise<x402.x402SupportedKind>[]; getRequirements: ( req: x402PaymentRequirementsV1Strict[], ) => Promise<x402.x402PaymentRequirements[]>; handleVerify?: ( requirements: x402PaymentRequirementsV1Strict, payment: x402.x402PaymentPayload, ) => Promise<x402.x402VerifyResponse or null>; handleSettle: ( requirements: x402PaymentRequirementsV1Strict, payment: x402.x402PaymentPayload, ) => Promise<x402.x402SettleResponseLegacy or null>; }` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/middleware](https://www.npmjs.com/package/@faremeter/middleware) - Server middleware that uses facilitator
- [@faremeter/payment-solana](https://www.npmjs.com/package/@faremeter/payment-solana) - Solana payment handler
- [@faremeter/payment-evm](https://www.npmjs.com/package/@faremeter/payment-evm) - EVM payment handler

## License

LGPL-3.0-only
