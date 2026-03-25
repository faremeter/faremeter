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
