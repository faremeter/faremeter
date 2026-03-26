import { type } from "arktype";

export const solanaChargeMethodDetails = type({
  "network?": "string",
  "decimals?": "number",
  "tokenProgram?": "string",
  "feePayer?": "boolean",
  "feePayerKey?": "string",
  "recentBlockhash?": "string",
  "splits?": type({
    recipient: "string",
    amount: "string",
    "memo?": "string",
  }).array(),
});

export type solanaChargeMethodDetails = typeof solanaChargeMethodDetails.infer;

export const mppChargeRequest = type({
  amount: "string.numeric",
  currency: "string",
  recipient: "string",
  "description?": "string",
  "externalId?": "string",
  "methodDetails?": solanaChargeMethodDetails,
});

export type mppChargeRequest = typeof mppChargeRequest.infer;

export const chargeCredentialPayload = type(
  {
    type: "'transaction'",
    transaction: "string",
  },
  "|",
  {
    type: "'signature'",
    signature: "string",
  },
);

export type chargeCredentialPayload = typeof chargeCredentialPayload.infer;
