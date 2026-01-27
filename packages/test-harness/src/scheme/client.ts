/* eslint-disable @typescript-eslint/no-deprecated -- v1 test harness uses v1 types */
import type {
  PaymentHandlerV1,
  PaymentExecerV1,
  RequestContext,
} from "@faremeter/types/client";
import type { x402PaymentRequirements } from "@faremeter/types/x402";

import { isMatchingRequirement } from "./constants";
import { generateTestId, type TestPaymentPayload } from "./types";

export type CreateTestPaymentHandlerOpts = {
  onMatch?: (requirements: x402PaymentRequirements) => void;
  onExec?: (
    requirements: x402PaymentRequirements,
    payload: TestPaymentPayload,
  ) => void;
  metadata?: Record<string, unknown>;
};

/**
 * Create a test payment handler.
 *
 * This handler creates simple test payment payloads without any cryptographic
 * operations, making it suitable for testing the x402 protocol flow.
 */
export function createTestPaymentHandler(
  opts: CreateTestPaymentHandlerOpts = {},
): PaymentHandlerV1 {
  const { onMatch, onExec, metadata } = opts;

  return async function handlePayment(
    _context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecerV1[]> {
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
