# Faremeter Compatibility

## MPP (Machine Payments Protocol)

Faremeter supports [MPP](https://mpp.dev) via an adapter layer that translates MPP interactions into x402v2 format. This means existing payment handlers and settlement logic work with MPP out of the box — no separate facilitator path is needed.

MPP is a settle-only flow; there is no separate verify step as there is with x402. Faremeter currently supports the `charge` intent only. Because MPP credentials are translated to x402v2, the supported payment methods are determined by whichever x402 handlers are configured.

### Current Limitations

- Re-challenge on credential failure sends x402 format headers rather than MPP challenge headers.
- Request body digest verification (MPP Spec Section 5.1.3) is not yet implemented.
- Challenge replay protection (MPP Spec Section 11.3) is not yet implemented.

## MPP `solana` / `session` intent

Faremeter ships an experimental `session` intent handler for the `solana`
method at `packages/payment-solana/src/session/`. It is settled against
the [Faremeter Flex](https://github.com/faremeter/flex) escrow program,
which is a generalised batched-authorization escrow rather than a
purpose-built payment-channel program.

The handler is **not** a conforming implementation of
`draft-solana-session-00`. The reference spec assumes a payment-channel
program (one cumulative `settled` watermark per channel, single-shot
settle, payer-initiated grace-period close); Flex is structurally a
different shape and the gaps between them cannot be closed by off-chain
code alone.

Where the spec is prescriptive about a particular wire format or field
shape and Flex doesn't take a position, the handler can — and over time
will — match the spec exactly. Where the spec depends on functionality
the Flex on-chain program doesn't have, the handler diverges and this
section documents why.

### Functional gaps in Flex relative to the spec

These are capabilities the spec depends on that Flex's on-chain program
does not have. Closing them requires program changes, not handler
changes.

#### Cumulative-amount on-chain settlement

The spec's `settle` instruction takes a voucher that attests to a
cumulative total and pulls `cumulativeAmount - settled` to the payee in
a single transaction. The Flex program has no instruction shaped this
way. Each Flex settlement is a discrete `submit_authorization` for a
fresh `(authorizationId, max_amount, splits)` tuple, two-phase, with a
mandatory wait between phases. Cumulative-amount semantics are
trackable off-chain but not enforceable on-chain — the Flex program
will never refuse a duplicate or out-of-order claim against a
cumulative watermark, because it has no concept of one.

This is the deepest mismatch and the reason the handler carries
Flex-specific fields (`mint`, `authorizationId`, `maxAmount`,
`splits`) on the voucher payload alongside the spec-shaped
`cumulativeAmount`. The signed bytes for the two views differ; a
single signature cannot satisfy both claims.

The direct consequence is that **the on-chain program never verifies
the spec voucher's `cumulativeAmount` bytes**. Spec §"On-Chain
Voucher Verification" MUSTs that channel programs verify the signed
voucher message on chain via an `ed25519` precompile instruction
and correlate the verified bytes to `channelId`, `cumulativeAmount`,
and signer. Flex's `submit_authorization` instruction verifies a
different byte layout (a packed binary over `programId`, `escrow`,
`mint`, `maxAmount`, `authorizationId`, `expiresAtSlot`, and
`splits`). The spec voucher signature is verified off-chain by the
Faremeter session handler; nothing on chain ever consumes it.
Closing this gap requires either (a) a Flex program change that
adds a new settle path correlating an ed25519-verified spec voucher
message to on-chain state, or (b) a second `ed25519` pre-verify
instruction bundled with `submit_authorization` and a matching
program-side check — neither of which are possible without touching
the on-chain program.

#### Payer-initiated immediate close with grace period

The spec's `requestClose` lets the payer signal "I'm done, server has
N minutes to drain pending vouchers, then refund the remainder." Flex
does not have a payer-initiated close path that begins a grace
window. Flex's `force_close` is gated on `last_activity_slot +
deadman_timeout_slots` — that is, on inactivity, not on a payer
request — so a payer who wants to leave a session that is still being
served has no on-chain mechanism to do so. The closest equivalent is
to stop submitting vouchers and wait for the deadman timeout to
expire.

#### No `closeRequestedAt` / `ClosedChannel` discriminator

Spec §"Voucher Verification" steps 6 and 7 require the server to
check, before accepting a voucher, that the channel's on-chain
discriminator is not `ClosedChannel` and that `closeRequestedAt ==
0`. Both are on-chain fields the spec's reference channel program
maintains. Flex has neither. A Flex escrow lives in a single account
shape from `create_escrow` until `finalize`/`refund`/`force_close`
removes it; there is no in-band "closing" state the on-chain
program surfaces, and there is no payer-initiated close request
the spec's `closeRequestedAt` would reflect.

The Faremeter handler approximates the spec's intent with an
off-chain `SessionStatus` (`"open" | "closing" | "closed"`) carried
in its `SessionStore`, and will reject voucher acceptance on
channels whose off-chain status is not `"open"` once that
enforcement is wired through `handleSettle`. This is sufficient
**only when the handler is in-band for every close**. A close
initiated directly on chain — for example, the Flex deadman path
firing after `last_activity_slot + deadman_timeout_slots`, or a
payer calling `refund` on an expired `PendingSettlement` — will
not update the off-chain `SessionStatus` until the handler reads
the escrow account back from RPC. Until that read happens, the
handler will continue to accept vouchers against an escrow that
has already been torn down on chain. Spec-literal enforcement
would require a matching on-chain field; with Flex the closest
available signal is "the escrow account no longer exists," which
requires an RPC read per voucher to detect.

#### MAX_PENDING = 16 ceiling

The Flex program enforces a hard cap of 16 simultaneous unsettled
authorizations per escrow. A workload that needs to push more than 16
vouchers between server-side finalizations is back-pressured at the
program level. The spec's single-watermark model has no equivalent
ceiling; once a cumulative voucher is accepted, the server can take
arbitrarily long to actually settle without blocking new vouchers.

The handler exposes this as a non-spec extension Problem Details
response so clients can back off and retry, but spec-compliant clients
have no way to handle it.

#### Settlement latency from `refund_timeout_slots`

Flex's two-phase model holds settled funds in a `PendingSettlement`
PDA for `refund_timeout_slots` before the merchant can call
`finalize` to claim them. During that window the payer can call
`refund` to reclaim the funds. The spec's `settle` is a single
transaction with no mandatory waiting period — the merchant gets
funds immediately. On Flex the merchant is exposed to a latency floor
on every settlement equal to the refund window.

#### Token-2022 transfer hooks

The spec requires deposit, settle, and refund flows to resolve and
include the extra accounts a Token-2022 transfer-hook program needs.
The Flex program does not currently pass these accounts, so any token
mint with a transfer-hook extension is unusable as a session asset.
This is a hard capability gap, not a shape difference.

#### Channel PDA seed binding

The spec mandates (§"Channel State") that the channel PDA seeds bind
the program ID, payer, payee, asset, authorized signer, and a
client-chosen salt or nonce, and that "Relying on a client-declared
`channelId` string alone is NOT sufficient." The Flex escrow PDA is
derived from `(programId, "escrow", owner, index)` only — there is no
slot for the payee, the asset (mint), or the authorized signer in the
seed set. The Flex program will reject any attempt to create an
escrow with seeds that include those fields, because the
`seeds = [b"escrow", owner.key().as_ref(), &index.to_le_bytes()]`
constraint is enforced at the program level.

The handler re-derives the Flex PDA from `(owner, index)` and
verifies the credential's `channelId` matches what the open
transaction is creating, but the spec MUST that the channel address
cryptographically binds payee/asset/signer cannot be satisfied
without changing the on-chain program. A voucher signed for one
Flex escrow cannot be replayed to another one (the voucher signature
includes the escrow address), but the channel address by itself
does not attest to the payee, asset, or signer.

The same seed limitation means the spec's "Settlement Procedure /
Open" step 6 requirement that the open transaction's payee match
the challenge `recipient` cannot be verified against the escrow
itself — the escrow is not a per-payee account and does not carry
a payee field on chain. On Flex, a payee assertion only exists
per-authorization via the `splits` array inside `submit_authorization`,
which the handler can (and should) cross-check against the
challenge's `defaultSplits` at voucher time. At open time there is
no payee to check, because Flex doesn't model one.

### Spec-aligned wire details

These are places where the spec is opinionated, Flex has no on-chain
stake, and the handler matches the spec wire format. They were
realigned in this branch:

- **Open credential schema**: spec §"Action: open" requires `payer`,
  `depositAmount`, `transaction`, and an initial signed `voucher`.
  The handler's `solanaSessionOpenPayload` carries all four; the
  Flex extension on the open path is optional because Flex doesn't
  need an on-chain authorization for a 0-cumulative initial voucher.
- **TopUp credential schema**: spec §"Action: topUp" carries
  `channelId`, `additionalAmount`, and `transaction`. The handler's
  `solanaSessionTopUpPayload` matches; the field is named
  `additionalAmount` per spec, not `additionalDeposit`.
- **Voucher / close credential schemas**: spec §"Action: voucher"
  and §"Action: close" carry `channelId` and the (optional, for
  close) signed voucher only. No top-level `sessionKey` (the
  sessionKey is implicit from the channel's authorized signer); the
  voucher's `signer` field is the source of truth for who attested
  to it.
- **Voucher payload shape**: nested `voucher` object carrying spec
  voucher data, with `signer`, `signature`, `signatureType: "ed25519"`
  per spec §"Signed Voucher". Flex-specific authorization fields
  live alongside under a sibling `flex` extension object documented
  below.
- **Voucher `expiresAt` enforcement**: the spec voucher data
  `expiresAt` field (ISO 8601) is checked against the system clock
  with a configurable skew tolerance per spec §"Voucher Verification"
  step 9. The handler's `clockSkewSeconds` arg defaults to 30
  seconds per spec §"Clock Skew".
- **Voucher signing**: the client signs JCS-canonicalized voucher
  data and encodes the signature as base58 per spec §"Voucher
  Signing". The server verifies this signature first; the Flex
  authorization signature is also carried and verified, because the
  Flex on-chain `submit_authorization` instruction needs it. Both
  signatures are produced by the same Ed25519 session key.
- **Method-details field naming**: `channelProgram`, `decimals`,
  `tokenProgram`, `feePayer`, `feePayerKey`, `minVoucherDelta`,
  `ttlSeconds`, `gracePeriodSeconds`, `network` (restricted to
  `mainnet-beta`/`devnet`/`localnet`), `channelId` follow the spec
  exactly. Flex-specific configuration (`facilitator`,
  `recentBlockhash`, `splits`, `refundTimeoutSlots`,
  `deadmanTimeoutSlots`, `minGracePeriodSlots`) lives under a nested
  `flex` sub-object so the spec slice stays clean.
- **Receipt fields**: `mppReceipt` carries `intent`,
  `acceptedCumulative`, `spent`, and `challengeId` as top-level
  fields per spec §"Receipt Format". The `extra` map remains for
  handler-specific data but the spec-defined fields are no longer
  hidden inside it.
- **Problem Details URIs**: error responses use
  `https://paymentauth.org/problems/verification-failed` (and the
  other two spec-defined types) per spec §"Error Responses". The
  handler's `buildInsufficientHoldProblem` and
  `buildSessionNotFoundProblem` both return `verification-failed`
  with descriptive `detail` strings.
- **`WWW-Authenticate` on error responses**: the handler exposes
  `formatProblemResponse(problem, pricing, resourceURL)` which mints
  a fresh challenge and attaches it as `WWW-Authenticate: Payment
...` to the 402 response, satisfying the spec MUST that all error
  responses include a fresh challenge.
- **`Idempotency-Key` header support**: the handler exposes
  `lookupIdempotent(challengeId, key)` and `recordIdempotent(...)`
  for the protected-resource body callback to dedupe duplicate
  requests per spec §"Concurrency and Idempotency". The
  `(challengeId, key)` cache is in-memory.
- **Per-channel serialization**: `tryRegisterVoucher` and
  `chargeSession` are wrapped in a per-`channelId` mutex internally;
  the handler also exposes `withChannelLock(channelId, fn)` for
  application code that needs to serialize additional state-mutating
  work against the same channel.
- **Idempotent equal-cumulative voucher resubmission**: equal
  resubmission returns success without state change; lower-cumulative
  replays return success without reducing state per spec §"Concurrency
  and Idempotency".
- **Open-credential verification**: `handleSettle` for an `open`
  action verifies the initial signed voucher per spec §"Voucher
  Verification" (signature, channelId binding, optional
  `expiresAt`), then decodes the wire transaction in
  `payload.transaction`, locates the three Flex instructions
  (`create_escrow`, `deposit`, `register_session_key`), re-derives
  the escrow PDA from `(owner, index)` and verifies it matches the
  credential's `channelId`, re-derives the vault and
  session-key-account PDAs from the parsed instruction args, and
  verifies all three instructions reference consistent accounts. The
  voucher's `signer` field is the source of truth for the session
  key that must be registered by `register_session_key`. This
  satisfies the off-chain pre-broadcast portion of spec
  §"Settlement Procedure / Open"; on-chain confirmation reads are
  still deferred (see Deferred section below). The PDA seed binding
  gap is documented under "Functional gaps in Flex" above and
  cannot be closed off-chain.

### Faremeter extension Problem Details

The Flex on-chain back-pressure has no spec equivalent and is
exposed as a Faremeter-namespaced extension Problem Details type
clients can recognise:

- `https://faremeter.org/problems/flex-pending-limit` — emitted when
  the escrow already has the maximum 16 unsettled
  `PendingSettlement` PDAs the Flex program enforces. Spec-compliant
  clients have no way to handle this; only Faremeter-aware clients
  can back off and retry.

### Where Flex is a superset

These are places where the spec is more restrictive than Flex. The
handler exposes the spec slice by default and treats the extra
capability as a Faremeter extension:

- Multiple session keys per escrow (Flex allows up to 8; spec assumes
  one `authorizedSigner`). The handler's `SessionStore` is keyed by
  `channelId` alone, matching the spec's one-session-per-channel
  model. Flex's multi-key feature is unused by the handler.
- Multiple mints per escrow (Flex allows up to 8; spec assumes one
  token per channel)
- Per-authorization splits (Flex routes per-payment; spec assumes one
  `payee` per channel)
- Configurable per-escrow refund and deadman timeouts (Flex
  parameterises both at create time; spec defines a single grace
  period)

### Deferred (not yet implemented in the handler)

These are spec MUSTs that the handler does not currently satisfy.
They're not blocked by Flex; they're just not done yet:

- **On-chain confirmation reads after open**. The handler verifies
  the open transaction's structure off-chain and re-derives the PDAs
  it expects, but does not broadcast the transaction or read the
  confirmed channel state back from RPC. Spec §"Settlement Procedure
  / Open" requires both. (The `rpc` parameter on the handler is
  unused for now.)
- **`topUp` / `close` settlement paths**. The credential validators
  exist for both actions and `handleSettle` returns a stub receipt,
  but neither broadcasts to chain or updates session state.
- **Background flush/finalize loop** for in-flight Flex
  authorizations. Vouchers are accepted into the session store and
  the `inFlightAuthorizationIds` list grows, but nothing actually
  submits them to chain.
- **Streaming-response receipts** (spec §"Receipt Format").
- **Crash-safe persistence**. The default `SessionStore` is
  in-memory; the spec MUSTs persistent storage of `acceptedCumulative`
  before relying on a new voucher and `spent` before serving the
  resource. The `SessionStore` interface is pluggable, so a durable
  backend is straightforward to add.

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
