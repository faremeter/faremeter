import { x402PaymentRequirements } from "./x402";

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
  accepts: x402PaymentRequirements[],
) => Promise<PaymentExecer[]>;
