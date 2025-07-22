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

export function headerToX402PaymentPayload(header: string) {
  return type("string.base64")
    .pipe.try((x) => atob(x))
    .to("string.json.parse")
    .to(x402PaymentPayload)(header);
}

export const x402VerifyRequest = type({
  x402Version: "number.integer",
  paymentHeader: "string",
  paymentRequirements: x402PaymentRequirements,
});

export type x402VerifyRequest = typeof x402VerifyRequest.infer;

export const x402SettleRequest = x402VerifyRequest;
export type x402SettleRequest = typeof x402SettleRequest.infer;

export const x402SettleResponse = type({
  success: "boolean",
  error: "string | null",
  txHash: "string | null",
  networkId: "string | null",
});

export type x402SettleResponse = typeof x402SettleResponse.infer;

export const x402SupportedResponse = type({
  kinds: [
    {
      scheme: "string",
      network: "string",
    },
  ],
});

export type x402SupportedResponse = typeof x402SupportedResponse.infer;

export type RequestContext = {
  request: RequestInfo | URL;
};

export type PaymentExecResult = {
  payload: object;
};

export type PaymentExecer = {
  requirements: x402PaymentRequirements;
  exec(): Promise<PaymentExecResult>;
};

export type PaymentHandler = (
  context: RequestContext,
  requiredResponse: x402PaymentRequirements[],
) => Promise<PaymentExecer[]>;
