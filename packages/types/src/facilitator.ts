import type {
  x402PaymentRequirements,
  x402SettleResponse,
  x402PaymentPayload,
  x402SupportedKind,
  x402VerifyResponse,
  x402ResourceInfo,
} from "./x402v2";

export interface GetRequirementsArgs {
  accepts: x402PaymentRequirements[];
  resource?: x402ResourceInfo;
}

export interface FacilitatorHandler {
  getSupported?: () => Promise<x402SupportedKind>[];
  getRequirements: (
    args: GetRequirementsArgs,
  ) => Promise<x402PaymentRequirements[]>;
  handleVerify?: (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => Promise<x402VerifyResponse | null>;
  handleSettle: (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => Promise<x402SettleResponse | null>;
  getSigners?: () => Promise<Record<string, string[]>>;
}
