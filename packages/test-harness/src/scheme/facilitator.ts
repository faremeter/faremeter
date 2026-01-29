import { type } from "arktype";
import { isValidationError } from "@faremeter/types";
import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402VerifyResponse,
  x402SupportedKind,
} from "@faremeter/types/x402v2";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";

import { TEST_SCHEME, TEST_NETWORK, TEST_ASSET } from "./constants";
import type { TestPaymentPayload } from "./types";

const testPaymentPayload = type({
  testId: "string > 0",
  amount: "string > 0",
  timestamp: "number > 0",
  "metadata?": "Record<string, unknown>",
});

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
  const result = testPaymentPayload(payload);
  if (isValidationError(result)) {
    return { valid: false, error: result.summary };
  }
  return { valid: true, payload: result };
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
        x402Version: 2 as const,
        scheme: TEST_SCHEME,
        network: TEST_NETWORK,
      }),
    ];
  };

  const getRequirements = async ({
    accepts: req,
  }: {
    accepts: x402PaymentRequirements[];
  }): Promise<x402PaymentRequirements[]> => {
    // || is intentional: tests pass empty strings to signal "not provided".
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
    if (testPayload.amount !== requirements.amount) {
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
        transaction: "",
        network: requirements.network,
      };
    }

    const testPayload = result.payload;

    // Verify amount matches
    if (testPayload.amount !== requirements.amount) {
      return {
        success: false,
        errorReason: "Amount mismatch",
        transaction: "",
        network: requirements.network,
      };
    }

    // Verify payment is to the correct address
    if (requirements.payTo.toLowerCase() !== payTo.toLowerCase()) {
      return {
        success: false,
        errorReason: "Payment to wrong address",
        transaction: "",
        network: requirements.network,
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
