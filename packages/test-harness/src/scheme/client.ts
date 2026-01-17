import type {
  PaymentHandler,
  PaymentExecer,
  RequestContext,
} from "@faremeter/types/client";
import type { x402PaymentRequirements } from "@faremeter/types/x402";

import { TEST_SCHEME, TEST_NETWORK } from "./constants";
import { generateTestId, type TestPaymentPayload } from "./types";

export type CreateTestPaymentHandlerOpts = {
  onMatch?: (requirements: x402PaymentRequirements) => void;
  onExec?: (
    requirements: x402PaymentRequirements,
    payload: TestPaymentPayload,
  ) => void;
  metadata?: Record<string, unknown>;
};

function isMatchingRequirement(req: x402PaymentRequirements): boolean {
  return (
    req.scheme.toLowerCase() === TEST_SCHEME.toLowerCase() &&
    req.network.toLowerCase() === TEST_NETWORK.toLowerCase()
  );
}

/**
 * Create a test payment handler.
 *
 * This handler creates simple test payment payloads without any cryptographic
 * operations, making it suitable for testing the x402 protocol flow.
 */
export function createTestPaymentHandler(
  opts: CreateTestPaymentHandlerOpts = {},
): PaymentHandler {
  const { onMatch, onExec, metadata } = opts;

  return async function handlePayment(
    _context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> {
    const compatibleRequirements = accepts.filter(isMatchingRequirement);

    return compatibleRequirements.map((requirements) => {
      if (onMatch) {
        onMatch(requirements);
      }

      return {
        requirements,
        exec: async () => {
          const payload: TestPaymentPayload = {
            testId: generateTestId(),
            amount: requirements.maxAmountRequired,
            timestamp: Date.now(),
            metadata,
          };

          if (onExec) {
            onExec(requirements, payload);
          }

          return { payload };
        },
      };
    });
  };
}
