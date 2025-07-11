import { type } from "arktype";

export const PaymentRequirements = type({
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

export type PaymentRequirements = typeof PaymentRequirements.infer;

export const PaymentRequiredResponse = type({
  x402Version: "number.integer",
  accepts: PaymentRequirements.array(),
  error: "string?",
});

export type PaymentRequiredResponse = typeof PaymentRequiredResponse.infer;

export const PaymentPayload = type({
  x042Version: "number.integer",
  scheme: "string",
  network: "string",
  payload: "object",
});

export type PaymentPayload = typeof PaymentPayload.infer;

export type RequestContext = {
  request: RequestInfo | URL;
};

export type PaymentExecResult = {
  headers: HeadersInit;
};

export type PaymentExecer = {
  requirements: PaymentRequirements;
  exec(): Promise<PaymentExecResult>;
};

export type PaymentHandler = (
  context: RequestContext,
  requiredResponse: PaymentRequirements[],
) => Promise<PaymentExecer[]>;
