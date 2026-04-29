# Faremeter: Frictionless Agentic Payments

Faremeter is a collection of libraries, tools, and applications designed to allow agents and other utilities to transparently make web3 payments using web2 infrastructure. By leveraging existing and emerging standards, you can use Faremeter to attach new and legacy client SDKs and API services to blockchain payments, without extensive rewrites.

Under the hood, Faremeter is built around:

- Using HTTP and the existing `402 Payment Required` concepts.
- A plugin system that's standard, wallet, and blockchain agnostic.
- Wrappers, middleware, and proxies that let you easily integrate into your existing codebase.

For more information on our approach, take a look at our [architecture document](./ARCHITECTURE.md).

The implication of this is:

- New payment strategies (e.g. [x402 Schemes](https://github.com/coinbase/x402?tab=readme-ov-file#schemes)) can be developed outside of the core Faremeter project.
- Blockchains with specific behaviors and needs can be supported without forcing a one-size-fits-all approach.
- Wallets and other infrastructure can be connected to Faremeter without "official" support.

To get started with the tooling, take a look at the [quickstart guide](./QUICKSTART.md). To start developing, take a look at the [developer notes](./DEV.md).

## Standards

Faremeter supports the following industry standards today:

- [Coinbase's x402](https://github.com/coinbase/x402) — both v1 and v2 of the protocol, negotiated automatically.
- [MPP (Machine Payments Protocol)](https://mpp.dev) — the spec is still evolving; we currently ship the `charge` intent on Solana.

We're tracking these for future support:

- [Agent Payments Protocol (AP2)](https://github.com/google-agentic-commerce/AP2)
- [Cloudflare's Pay-Per-Crawl](https://www.cloudflare.com/paypercrawl-signup/)
- [L402](https://www.l402.org)

See the [compatibility document](./COMPATIBILITY.md) for the detailed status of each standard.

## What's in the box

Faremeter ships with payment support for both the Solana and EVM ecosystems:

- A pluggable [client library](./packages/fetch).
- A [middleware](./packages/middleware) with both remote and in-process payment handlers, plus an [OpenAPI-driven pricing middleware](./packages/middleware-openapi) for spec-driven endpoints.
- Solana payment schemes (`flex`, `exact`, and the MPP `charge` intent) in [@faremeter/payment-solana](./packages/payment-solana).
- EVM `exact` over EIP-3009 gasless USDC in [@faremeter/payment-evm](./packages/payment-evm), with network coverage including Base, Polygon, Monad, and Skale (mainnet and testnets).
- A [payment facilitator](./packages/facilitator) and legacy service proxy, plus an [nginx gateway](./packages/gateway-nginx).
- Wallet integrations for [Solana](./packages/wallet-solana), [EVM](./packages/wallet-evm), [Ledger](./packages/wallet-ledger), [Squads multisig](./packages/wallet-solana-squads), [Crossmint](./packages/wallet-crossmint), and [OWS](./packages/wallet-ows).

## Sponsorship

Faremeter is sponsored and built by the engineers at [ABK Labs](https://abklabs.com) along with other open-source contributors.
