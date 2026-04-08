import { type } from "arktype";
import {
  sessionOpenBase,
  sessionTopUpBase,
  sessionVoucherBase,
  sessionCloseBase,
  sessionRequestBase,
} from "@faremeter/types/mpp";

// Spec-aligned challenge `methodDetails` for the Solana session intent.
// Field names track draft-solana-session-00 §"Method Details" where the
// spec is opinionated; Flex-specific extensions live under the nested
// `flex` sub-object so the spec slice stays clean.
export const solanaSessionMethodDetails = type({
  // draft-solana-session-00 §"Method Details"
  "network?": "'mainnet-beta'|'devnet'|'localnet'",
  channelProgram: "string",
  "channelId?": "string",
  decimals: "number",
  "tokenProgram?": "string",
  "feePayer?": "boolean",
  "feePayerKey?": "string",
  "minVoucherDelta?": "string.numeric",
  "ttlSeconds?": "number",
  "gracePeriodSeconds?": "number",
  // Flex-specific extension. The Flex on-chain program needs the
  // facilitator pubkey, recent blockhash, splits, and per-escrow
  // refund/deadman slot counters that the spec doesn't model.
  // Documented in COMPATIBILITY.md.
  flex: type({
    facilitator: "string",
    "recentBlockhash?": "string",
    splits: type({ recipient: "string", bps: "number" }).array(),
    refundTimeoutSlots: "string.numeric",
    deadmanTimeoutSlots: "string.numeric",
    minGracePeriodSlots: "string.numeric",
  }),
});
export type solanaSessionMethodDetails =
  typeof solanaSessionMethodDetails.infer;

export const solanaSessionRequest = sessionRequestBase.and({
  methodDetails: solanaSessionMethodDetails,
});
export type solanaSessionRequest = typeof solanaSessionRequest.infer;

// `transaction` (the wire-format base64 transaction) and the spec
// `voucher` (REQUIRED initial signed voucher) are forward declared so
// the open and topUp payloads can reference them. The voucher
// definition lives below alongside the per-action voucher payload.

export const solanaSessionTopUpPayload = sessionTopUpBase.and({
  transaction: "string",
});
export type solanaSessionTopUpPayload = typeof solanaSessionTopUpPayload.infer;

export const solanaSessionVoucherSplit = type({
  recipient: "string",
  bps: "number",
});
export type solanaSessionVoucherSplit = typeof solanaSessionVoucherSplit.infer;

// Spec-shaped voucher data per draft-solana-session-00 §"Voucher Format /
// Voucher Data". This is what the spec signature is computed over (JCS-
// canonicalized).
//
// `cumulativeAmount` is constrained to a non-negative decimal integer
// string. arktype's `string.numeric` admits decimals (`"1.5"`) and
// negatives (`"-1"`), neither of which is meaningful in base units.
export const solanaVoucherData = type({
  channelId: "string",
  cumulativeAmount: /^(0|[1-9][0-9]*)$/,
  "expiresAt?": "string",
});
export type solanaVoucherData = typeof solanaVoucherData.infer;

// Spec-shaped signed voucher per §"Signed Voucher".
export const solanaSignedVoucher = type({
  voucher: solanaVoucherData,
  signer: "string",
  signature: "string",
  signatureType: "'ed25519'",
});
export type solanaSignedVoucher = typeof solanaSignedVoucher.infer;

// Faremeter extension carried alongside the spec-shaped voucher. The
// Flex on-chain program signs over a different byte layout (packed
// binary including programId, mint, splits, authorizationId,
// maxAmount, expiresAtSlot) and uses a fresh per-authorization id, so
// we carry the Flex authorization fields and Flex signature as a
// sibling extension. Documented in COMPATIBILITY.md.
export const flexVoucherExtension = type({
  mint: "string",
  authorizationId: "string.numeric",
  maxAmount: "string.numeric",
  expiresAtSlot: "string.numeric",
  splits: solanaSessionVoucherSplit.array(),
  signature: "string",
});
export type flexVoucherExtension = typeof flexVoucherExtension.infer;

// Per draft-solana-session-00 §"Action: voucher": the credential
// carries `action`, `channelId`, and the signed `voucher` only. The
// `flex` extension is a Faremeter extension required by the Flex
// on-chain settlement path; spec-conforming clients omit it. The
// handler enforces its presence at the actual Flex-settlement step,
// not at credential-validation time.
export const solanaSessionVoucherPayload = sessionVoucherBase.and({
  voucher: solanaSignedVoucher,
  "flex?": flexVoucherExtension,
});
export type solanaSessionVoucherPayload =
  typeof solanaSessionVoucherPayload.infer;

// Spec §"Action: open" requires the open credential to carry an
// initial signed voucher. Flex doesn't need an on-chain authorization
// for a 0-cumulative initial voucher, so the `flex` extension is
// optional here — clients SHOULD set it only when the initial voucher
// authorizes a non-zero amount that the server should be able to
// settle on chain.
export const solanaSessionOpenPayload = sessionOpenBase.and({
  transaction: "string",
  voucher: solanaSignedVoucher,
  "flex?": flexVoucherExtension,
});
export type solanaSessionOpenPayload = typeof solanaSessionOpenPayload.infer;

// Per draft-solana-session-00 §"Action: close": `voucher` is OPTIONAL
// and the spec does not define a `closeTransaction` field. We accept
// an optional `closeTransaction` as a Faremeter extension carrying
// the partially-signed close transaction the server will co-sign and
// broadcast — but it MUST NOT be required for the credential to
// validate.
export const solanaSessionClosePayload = sessionCloseBase.and({
  "voucher?": solanaSignedVoucher,
  "closeTransaction?": "string",
});
export type solanaSessionClosePayload = typeof solanaSessionClosePayload.infer;

export const solanaSessionPayload = solanaSessionOpenPayload
  .or(solanaSessionTopUpPayload)
  .or(solanaSessionVoucherPayload)
  .or(solanaSessionClosePayload);
export type solanaSessionPayload = typeof solanaSessionPayload.infer;
