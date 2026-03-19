import { type } from "arktype";

export const MPP_PAYMENT_RECEIPT = "Payment-Receipt";

export const SUPPORTED_MPP_INTENTS = ["charge"] as const;
export type SupportedMPPIntent = (typeof SUPPORTED_MPP_INTENTS)[number];

export const mppChallengeParams = type({
  id: "string",
  realm: "string",
  method: "string",
  intent: "string",
  request: "string",
  "expires?": "string",
  "digest?": "string",
  "description?": "string",
  "opaque?": "string",
});

export type mppChallengeParams = typeof mppChallengeParams.infer;

export const mppChargeRequest = type({
  amount: "string.numeric",
  currency: "string",
  "recipient?": "string",
  "description?": "string",
  "externalId?": "string",
  "methodDetails?": "object",
});

export type mppChargeRequest = typeof mppChargeRequest.infer;

export const mppCredential = type({
  challenge: mppChallengeParams,
  "source?": "string",
  payload: "object",
});

export type mppCredential = typeof mppCredential.infer;

export const mppReceipt = type({
  status: '"success"',
  method: "string",
  timestamp: "string",
  reference: "string",
});

export type mppReceipt = typeof mppReceipt.infer;

export function isSupportedIntent(
  intent: string,
): intent is SupportedMPPIntent {
  return SUPPORTED_MPP_INTENTS.includes(intent as SupportedMPPIntent);
}
