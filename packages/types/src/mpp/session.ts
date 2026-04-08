import { type } from "arktype";

/**
 * Intent name that identifies a session-style handler. Register
 * handlers with `getSupportedIntents()` returning this constant.
 */
export const SESSION_INTENT = "session";

/**
 * Action discriminator for session credential payloads. Shared across
 * all chains; chain-specific handlers intersect their per-action
 * shapes with the corresponding base below.
 */
export const SessionAction = type("'open'|'topUp'|'voucher'|'close'");
export type SessionAction = typeof SessionAction.infer;

// Per draft-solana-session-00 §"Action: open". `payer`, `depositAmount`,
// and `transaction` are REQUIRED at the spec layer; the initial signed
// `voucher` is REQUIRED here too but lives in the chain-specific
// extension because the voucher format is method-specific.
export const sessionOpenBase = type({
  action: "'open'",
  channelId: "string",
  payer: "string",
  depositAmount: "string.numeric",
  "authorizationPolicy?": "Record<string, unknown>",
  "expiresAt?": "string",
  "capabilities?": "Record<string, unknown>",
});
export type sessionOpenBase = typeof sessionOpenBase.infer;

// Per spec §"Action: topUp". The spec carries channelId,
// additionalAmount, and transaction; there is no top-level signer.
export const sessionTopUpBase = type({
  action: "'topUp'",
  channelId: "string",
  additionalAmount: "string.numeric",
});
export type sessionTopUpBase = typeof sessionTopUpBase.infer;

// Per spec §"Action: voucher". The voucher data + signature live in
// the chain-specific extension; the base only carries the action and
// channelId.
export const sessionVoucherBase = type({
  action: "'voucher'",
  channelId: "string",
});
export type sessionVoucherBase = typeof sessionVoucherBase.infer;

// Per spec §"Action: close". The optional final voucher lives in the
// chain-specific extension.
export const sessionCloseBase = type({
  action: "'close'",
  channelId: "string",
});
export type sessionCloseBase = typeof sessionCloseBase.infer;

/**
 * Generic session challenge `request` body. Method-specific handlers
 * extend this with their own `methodDetails` shape via arktype's
 * intersection operators. `amount` is REQUIRED per
 * draft-solana-session-00 §"Request Schema / Shared Fields" — it
 * carries the price per unit of service. `description` and
 * `externalId` are OPTIONAL per the same section: human-readable
 * service description and merchant reconciliation id respectively.
 */
export const sessionRequestBase = type({
  amount: "string.numeric",
  "unitType?": "string",
  "suggestedDeposit?": "string.numeric",
  currency: "string",
  recipient: "string",
  "description?": "string",
  "externalId?": "string",
});
export type sessionRequestBase = typeof sessionRequestBase.infer;

/**
 * Standard Problem Details type URIs from draft-ietf-httpauth-payment.
 * draft-solana-session-00 §"Error Responses" requires servers to use
 * these three types and to attach a fresh `WWW-Authenticate` challenge
 * to every error response.
 */
export const PROBLEM_MALFORMED_CREDENTIAL =
  "https://paymentauth.org/problems/malformed-credential";
export const PROBLEM_INVALID_CHALLENGE =
  "https://paymentauth.org/problems/invalid-challenge";
export const PROBLEM_VERIFICATION_FAILED =
  "https://paymentauth.org/problems/verification-failed";

const baseProblemFields = {
  title: "string",
  status: "402",
  "detail?": "string",
  "instance?": "string",
} as const;

export const malformedCredentialProblem = type({
  type: `"${PROBLEM_MALFORMED_CREDENTIAL}"`,
  ...baseProblemFields,
});
export type malformedCredentialProblem =
  typeof malformedCredentialProblem.infer;

export const invalidChallengeProblem = type({
  type: `"${PROBLEM_INVALID_CHALLENGE}"`,
  ...baseProblemFields,
});
export type invalidChallengeProblem = typeof invalidChallengeProblem.infer;

export const verificationFailedProblem = type({
  type: `"${PROBLEM_VERIFICATION_FAILED}"`,
  ...baseProblemFields,
});
export type verificationFailedProblem = typeof verificationFailedProblem.infer;

export function buildVerificationFailedProblem(args: {
  title?: string;
  detail?: string;
  instance?: string;
}): verificationFailedProblem {
  const out: verificationFailedProblem = {
    type: PROBLEM_VERIFICATION_FAILED,
    title: args.title ?? "Verification failed",
    status: 402,
  };
  if (args.detail !== undefined) out.detail = args.detail;
  if (args.instance !== undefined) out.instance = args.instance;
  return out;
}

export function buildMalformedCredentialProblem(args: {
  title?: string;
  detail?: string;
  instance?: string;
}): malformedCredentialProblem {
  const out: malformedCredentialProblem = {
    type: PROBLEM_MALFORMED_CREDENTIAL,
    title: args.title ?? "Malformed credential",
    status: 402,
  };
  if (args.detail !== undefined) out.detail = args.detail;
  if (args.instance !== undefined) out.instance = args.instance;
  return out;
}

export function buildInvalidChallengeProblem(args: {
  title?: string;
  detail?: string;
  instance?: string;
}): invalidChallengeProblem {
  const out: invalidChallengeProblem = {
    type: PROBLEM_INVALID_CHALLENGE,
    title: args.title ?? "Invalid challenge",
    status: 402,
  };
  if (args.detail !== undefined) out.detail = args.detail;
  if (args.instance !== undefined) out.instance = args.instance;
  return out;
}
