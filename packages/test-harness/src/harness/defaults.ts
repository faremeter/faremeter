import { TEST_SCHEME, TEST_NETWORK, TEST_ASSET } from "../scheme/constants";
import type { x402PaymentRequirements } from "@faremeter/types/x402";

/**
 * Creates a payment requirements object with test defaults.
 * Override specific fields by passing a partial:
 *   accepts({ maxAmountRequired: "500" })
 */
export function accepts(
  overrides?: Partial<x402PaymentRequirements>,
): x402PaymentRequirements {
  return {
    scheme: TEST_SCHEME,
    network: TEST_NETWORK,
    maxAmountRequired: "100",
    resource: "http://example.com/test",
    description: "Test resource",
    mimeType: "application/json",
    payTo: "test-receiver",
    maxTimeoutSeconds: 30,
    asset: TEST_ASSET,
    ...overrides,
  };
}
