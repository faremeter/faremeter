import {
  x402PaymentRequirements,
  x402SettleResponse,
  x402PaymentPayload,
} from "./x402";

export type FacilitatorHandler = {
  getRequirements: () => Promise<x402PaymentRequirements[]>;
  handleSettle: (
    payment: x402PaymentPayload,
  ) => Promise<x402SettleResponse | null>;
};
