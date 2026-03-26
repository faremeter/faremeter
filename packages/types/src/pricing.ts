/**
 * Protocol-agnostic pricing configuration for a protected resource.
 *
 * This is the resource server's statement of "I want X amount of Y asset
 * paid to Z recipient on W network." It says nothing about x402 schemes,
 * MPP methods, or protocol extras -- those are handler output, not
 * middleware input.
 */
export type ResourcePricing = {
  amount: string;
  asset: string;
  recipient: string;
  network: string;
  description?: string;
};

/**
 * Declares what a handler can settle so the middleware can route
 * {@link ResourcePricing} entries without calling the handler.
 *
 * Used by both x402 `FacilitatorHandler` (optional) and MPP
 * `MPPMethodHandler` (required).
 *
 * `schemes` is x402-specific -- MPP handlers do not use it.
 */
export type HandlerCapabilities = {
  /** x402-specific. MPP handlers leave this empty or omit it. */
  schemes?: string[];
  networks: string[];
  assets: string[];
};

function lowerIncludes(list: string[], value: string): boolean {
  const lower = value.toLowerCase();
  return list.some((item) => item.toLowerCase() === lower);
}

/**
 * Returns pricing entries whose network and asset match the given
 * capabilities. Empty `networks` or `assets` arrays act as wildcards.
 */
export function matchPricingToCapabilities(
  capabilities: HandlerCapabilities,
  pricing: ResourcePricing[],
): ResourcePricing[] {
  return pricing.filter((p) => capabilitiesMatch(capabilities, p));
}

/**
 * Returns true when the given network and asset match the capabilities.
 * Empty `networks` or `assets` arrays act as wildcards.
 */
export function capabilitiesMatch(
  capabilities: HandlerCapabilities,
  criteria: { network: string; asset: string },
): boolean {
  const networkMatch =
    capabilities.networks.length === 0 ||
    lowerIncludes(capabilities.networks, criteria.network);
  const assetMatch =
    capabilities.assets.length === 0 ||
    lowerIncludes(capabilities.assets, criteria.asset);
  return networkMatch && assetMatch;
}
