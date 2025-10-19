import {
  x402PaymentRequirements,
  x402SettleResponse,
  x402PaymentPayload,
  x402SupportedKind,
} from "./x402";

export type FacilitatorHandler = {
  getSupported?: () => Promise<x402SupportedKind>[];
  getRequirements: (
    req: x402PaymentRequirements[],
  ) => Promise<x402PaymentRequirements[]>;
  handleSettle: (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => Promise<x402SettleResponse | null>;
};
