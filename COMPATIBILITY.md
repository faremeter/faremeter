# Faremeter Compatibility

## MPP (Machine Payments Protocol)

Faremeter supports [MPP](https://mpp.dev) as a peer protocol alongside x402, with its own challenge headers, credential type (`mppCredential`), handler interface (`MPPMethodHandler`), and settlement path. The middleware discriminates MPP from x402 v1/v2 via `protocolVersion` and dispatches to handlers configured under `mppMethodHandlers`.

The MPP spec is still evolving. Today Faremeter ships the `charge` intent on Solana; additional intents and chains will follow as the spec stabilizes.

## x402

Faremeter supports both v1 and v2 of the x402 protocol. The middleware negotiates protocol versions automatically, preferring v2 when both sides support it. Adapters handle translation between versions, so handlers written against either version work transparently.

Faremeter intends to be 100% compatible with the supported schemes and networks (e.g. exact on base-sepolia) provided by Coinbase's [x402](https://github.com/coinbase/x402) implementation. There are some areas where we will initially act as a superset (with a desire to upstream the concepts):

- Our client payment implementations are designed to not require the client be connected to any blockchain network. All information required for payment should come via the facilitator.
- We support schemes that don't require that the facilitator land the transaction on the chain.
- Our middleware is designed to interact with the facilitator, to enable dynamic pricing and API discovery.

### Client Payment

In general, we are designing our client payment implementations to not require any connection to services besides the facilitator (via the resource server). In certain cases, it requires that we send more information about the payment scheme to the client. We're accomplishing this by using the `extra` field of the payment requirements datastructure.

An example of this would be on Solana, this information would include a recent block hash for the network.

There are some cases where we can't depend on the facilitator landing the transaction on chain (e.g. third-party wallets). In these cases, we're developing schemes that let this type of transaction still happen securely (e.g. without double-spend/end-run issues).

### Interactive Middleware

In order to get up-to-date information about the blockchain being used for payment, it may be necessary for the middleware to converse with the facilitator more often. Our desire is to minimize this, and leverage existing HTTP caching standards/best-practices to cut down on the performance impact.

The upside is that by pushing more information to the facilitator more often, it's possible for the middleware and facilitator to help enable API discovery and work related to dynamic pricing.
