import {
  x402PaymentRequirements,
  x402SettleResponse,
  x402PaymentPayload,
  x402SupportedKind,
  x402VerifyResponse,
} from "./x402";

export type FacilitatorHandler = {
  getSupported?: () => Promise<x402SupportedKind>[];
  getRequirements: (
    req: x402PaymentRequirements[],
  ) => Promise<x402PaymentRequirements[]>;
  handleVerify?: (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => Promise<x402VerifyResponse | null>;
  handleSettle: (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => Promise<x402SettleResponse | null>;
};
