import {
  x402PaymentRequirements,
  x402SettleResponseLenient,
  x402PaymentPayload,
  x402SupportedKind,
  x402VerifyResponse,
} from "./x402";

/**
 * FacilitatorHandler interface for payment processing.
 *
 * handleSettle returns x402SettleResponseLenient to support both
 * legacy field names (txHash, networkId, error) and spec-compliant
 * field names (transaction, network, errorReason). Callers should
 * use normalizeSettleResponse() to normalize the response.
 */
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
  ) => Promise<x402SettleResponseLenient | null>;
};
