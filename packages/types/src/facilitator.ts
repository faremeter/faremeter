import {
  x402PaymentRequirements,
  x402SettleResponse,
  x402PaymentPayload,
} from "./x402";

export type FacilitatorHandler = {
  getRequirements: (
    req: x402PaymentRequirements[],
  ) => Promise<x402PaymentRequirements[]>;
  handleSettle: (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => Promise<x402SettleResponse | null>;
};
