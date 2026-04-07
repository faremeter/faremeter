import { type } from "arktype";

export const WWW_AUTHENTICATE_HEADER = "WWW-Authenticate";
export const AUTHORIZATION_HEADER = "Authorization";
export const PAYMENT_RECEIPT_HEADER = "Payment-Receipt";
export const MPP_PAYMENT_SCHEME = "Payment";

export const mppChallengeParams = type({
  id: "string",
  realm: "string",
  method: "string",
  intent: "string",
  request: "string",
  "expires?": "string",
  "description?": "string",
  "opaque?": "string",
  "digest?": "string",
});

export type mppChallengeParams = typeof mppChallengeParams.infer;

export const mppCredential = type({
  challenge: mppChallengeParams,
  "source?": "string",
  payload: "Record<string, unknown>",
});

export type mppCredential = typeof mppCredential.infer;

export const mppReceipt = type({
  status: "'success'|'failed'",
  method: "string",
  // draft-solana-session-00 §"Receipt Format" lists `intent` as
  // REQUIRED; the charge-intent receipt also carries it. Clients
  // use this to route receipts to the right per-intent handler.
  intent: "string",
  timestamp: "string",
  reference: "string",
  "challengeId?": "string",
  "acceptedCumulative?": "string.numeric",
  "spent?": "string.numeric",
  "extra?": "Record<string, unknown>",
}).onUndeclaredKey("reject");

export type mppReceipt = typeof mppReceipt.infer;
