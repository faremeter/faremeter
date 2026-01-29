import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402VerifyResponse,
  x402SupportedKind,
} from "@faremeter/types/x402";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";

import { TEST_SCHEME, TEST_NETWORK, TEST_ASSET } from "./constants";
import type { TestPaymentPayload } from "./types";

export type CreateTestFacilitatorHandlerOpts = {
  payTo: string;
  onVerify?: (
    requirements: x402PaymentRequirements,
    payload: x402PaymentPayload,
    testPayload: TestPaymentPayload,
  ) => void;
  onSettle?: (
    requirements: x402PaymentRequirements,
    payload: x402PaymentPayload,
    testPayload: TestPaymentPayload,
  ) => void;
};

function isMatchingRequirement(req: x402PaymentRequirements): boolean {
  return (
    req.scheme.toLowerCase() === TEST_SCHEME.toLowerCase() &&
    req.network.toLowerCase() === TEST_NETWORK.toLowerCase()
  );
}

function validateTestPayload(
  payload: object,
):
  | { valid: true; payload: TestPaymentPayload }
  | { valid: false; error: string } {
  const p = payload as Partial<TestPaymentPayload>;

  if (typeof p.testId !== "string" || p.testId.length === 0) {
    return { valid: false, error: "Missing or invalid testId" };
  }

  if (typeof p.amount !== "string" || p.amount.length === 0) {
    return { valid: false, error: "Missing or invalid amount" };
  }

  if (typeof p.timestamp !== "number" || p.timestamp <= 0) {
    return { valid: false, error: "Missing or invalid timestamp" };
  }

  return {
    valid: true,
    payload: {
      testId: p.testId,
      amount: p.amount,
      timestamp: p.timestamp,
      metadata: p.metadata,
    },
  };
}

/**
 * Create a test facilitator handler.
 *
 * This handler validates protocol structure without any cryptographic
 * operations, making it suitable for testing the x402 protocol flow.
 */
export function createTestFacilitatorHandler(
  opts: CreateTestFacilitatorHandlerOpts,
): FacilitatorHandler {
  const { payTo, onVerify, onSettle } = opts;

  const getSupported = (): Promise<x402SupportedKind>[] => {
    return [
      Promise.resolve({
        x402Version: 1,
        scheme: TEST_SCHEME,
        network: TEST_NETWORK,
      }),
    ];
  };

  const getRequirements = async (
    req: x402PaymentRequirements[],
  ): Promise<x402PaymentRequirements[]> => {
    return req.filter(isMatchingRequirement).map((r) => ({
      ...r,
      asset: r.asset || TEST_ASSET,
      payTo: r.payTo || payTo,
      maxTimeoutSeconds: r.maxTimeoutSeconds || 300,
    }));
  };

  const handleVerify = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ): Promise<x402VerifyResponse | null> => {
    if (!isMatchingRequirement(requirements)) {
      return null; // Not for us, let another handler try
    }

    const result = validateTestPayload(payment.payload);
    if (!result.valid) {
      return { isValid: false, invalidReason: result.error };
    }

    const testPayload = result.payload;

    // Verify amount matches
    if (testPayload.amount !== requirements.maxAmountRequired) {
      return { isValid: false, invalidReason: "Amount mismatch" };
    }

    // Verify payment is to the correct address
    if (requirements.payTo.toLowerCase() !== payTo.toLowerCase()) {
      return { isValid: false, invalidReason: "Payment to wrong address" };
    }

    if (onVerify) {
      onVerify(requirements, payment, testPayload);
    }

    return { isValid: true };
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ): Promise<x402SettleResponse | null> => {
    if (!isMatchingRequirement(requirements)) {
      return null; // Not for us, let another handler try
    }

    const result = validateTestPayload(payment.payload);
    if (!result.valid) {
      return {
        success: false,
        errorReason: result.error,
        transaction: null,
        network: null,
      };
    }

    const testPayload = result.payload;

    // Verify amount matches
    if (testPayload.amount !== requirements.maxAmountRequired) {
      return {
        success: false,
        errorReason: "Amount mismatch",
        transaction: null,
        network: null,
      };
    }

    // Verify payment is to the correct address
    if (requirements.payTo.toLowerCase() !== payTo.toLowerCase()) {
      return {
        success: false,
        errorReason: "Payment to wrong address",
        transaction: null,
        network: null,
      };
    }

    if (onSettle) {
      onSettle(requirements, payment, testPayload);
    }

    return {
      success: true,
      transaction: `test-tx-${testPayload.testId}`,
      network: TEST_NETWORK,
    };
  };

  return {
    getSupported,
    getRequirements,
    handleVerify,
    handleSettle,
  };
}
