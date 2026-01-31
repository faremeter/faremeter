/** Payment scheme identifier for test payments. */
export const TEST_SCHEME = "test";

/** Network identifier for test payments. */
export const TEST_NETWORK = "test-local";

/** Asset identifier for test payments. */
export const TEST_ASSET = "TEST";

/**
 * Checks if a payment requirement matches the test scheme and network.
 */
export function isMatchingRequirement(req: {
  scheme: string;
  network: string;
}): boolean {
  return (
    req.scheme.toLowerCase() === TEST_SCHEME.toLowerCase() &&
    req.network.toLowerCase() === TEST_NETWORK.toLowerCase()
  );
}
