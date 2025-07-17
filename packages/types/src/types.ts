import { type } from "arktype";

export const x402PaymentRequirements = type({
  scheme: "string",
  network: "string",
  maxAmountRequired: "string.numeric",
  resource: "string.url",
  description: "string",
  mimeType: "string",
  outputSchema: "object?",
  payTo: "string",
  maxTimeoutSeconds: "number.integer",
  asset: "string",
  extra: "object?",
});

export type x402PaymentRequirements = typeof x402PaymentRequirements.infer;

export const x402PaymentRequiredResponse = type({
  x402Version: "number.integer",
  accepts: x402PaymentRequirements.array(),
  error: "string?",
});

export type x402PaymentRequiredResponse =
  typeof x402PaymentRequiredResponse.infer;

export const x402PaymentPayload = type({
  x402Version: "number.integer",
  scheme: "string",
  network: "string",
  payload: "object",
});

export type x402PaymentPayload = typeof x402PaymentPayload.infer;

export type RequestContext = {
  request: RequestInfo | URL;
};

export type PaymentExecResult = {
  headers: HeadersInit;
};

export type PaymentExecer = {
  requirements: x402PaymentRequirements;
  exec(): Promise<PaymentExecResult>;
};

export type PaymentHandler = (
  context: RequestContext,
  requiredResponse: x402PaymentRequirements[],
) => Promise<PaymentExecer[]>;
