/**
 * x402 glue layer: bridges {@link ResourcePricing} and
 * {@link FacilitatorHandler} to produce x402 protocol types.
 *
 * The middleware imports these functions to stay protocol-agnostic.
 * When MPP arrives, an equivalent module provides the MPP glue.
 */

import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402VerifyResponse,
  x402ResourceInfo,
} from "./x402v2";
import type { FacilitatorHandler, GetRequirementsArgs } from "./facilitator";
import type { ResourcePricing, HandlerCapabilities } from "./pricing";

type Logger = {
  warning: (msg: string, ctx?: Record<string, unknown>) => void;
};

type ResolveOpts = {
  logger?: Logger;
};

function lowerIncludes(list: string[], value: string): boolean {
  const lower = value.toLowerCase();
  return list.some((item) => item.toLowerCase() === lower);
}

/**
 * Returns true if the given capabilities match the network and asset.
 * Empty arrays act as wildcards (match everything), supporting the HTTP
 * handler backward-compat path where the handler delegates all routing
 * to the remote facilitator.
 */
function matchesCapabilities(
  capabilities: HandlerCapabilities,
  network: string,
  asset: string,
): boolean {
  const networkMatch =
    capabilities.networks.length === 0 ||
    lowerIncludes(capabilities.networks, network);
  const assetMatch =
    capabilities.assets.length === 0 ||
    lowerIncludes(capabilities.assets, asset);
  return networkMatch && assetMatch;
}

/**
 * Returns handlers whose capabilities match the given network and asset.
 * Handlers without capabilities are excluded.
 *
 * Empty `networks` or `assets` arrays act as wildcards (match everything).
 * This supports the HTTP handler backward-compat path where the handler
 * delegates all routing to the remote facilitator.
 */
export function narrowHandlers(
  handlers: FacilitatorHandler[],
  criteria: { network: string; asset: string },
): FacilitatorHandler[] {
  return handlers.filter((h) => {
    if (!h.capabilities) return false;
    return matchesCapabilities(
      h.capabilities,
      criteria.network,
      criteria.asset,
    );
  });
}

function matchPricingToHandler(
  capabilities: HandlerCapabilities,
  pricing: ResourcePricing[],
): ResourcePricing[] {
  return pricing.filter((p) =>
    matchesCapabilities(capabilities, p.network, p.asset),
  );
}

function pricingToAccepts(
  pricing: ResourcePricing[],
  schemes: string[],
): x402PaymentRequirements[] {
  const accepts: x402PaymentRequirements[] = [];
  for (const p of pricing) {
    for (const scheme of schemes) {
      accepts.push({
        scheme,
        network: p.network,
        amount: p.amount,
        asset: p.asset,
        payTo: p.recipient,
        maxTimeoutSeconds: 0,
      });
    }
  }
  return accepts;
}

/**
 * Converts {@link ResourcePricing} entries into enriched
 * {@link x402PaymentRequirements} by routing through handlers.
 *
 * For each handler with capabilities, matches pricing entries by network
 * and asset, constructs skeletal x402 requirements using the handler's
 * declared schemes, then calls `handler.getRequirements()` to enrich
 * them with protocol-specific fields (extras, timeouts, etc.).
 *
 * Handlers without capabilities are skipped. If a handler throws,
 * the exception propagates to the caller.
 */
export async function resolveX402Requirements(
  handlers: FacilitatorHandler[],
  pricing: ResourcePricing[],
  resource: string,
  opts?: ResolveOpts,
): Promise<x402PaymentRequirements[]> {
  const results: x402PaymentRequirements[] = [];
  const resourceInfo: x402ResourceInfo = { url: resource };

  for (const handler of handlers) {
    if (!handler.capabilities) {
      opts?.logger?.warning(
        "skipping handler without capabilities for in-process resolution",
      );
      continue;
    }

    const schemes = handler.capabilities.schemes ?? [];
    if (schemes.length === 0) {
      opts?.logger?.warning(
        "skipping handler with no schemes for in-process resolution",
      );
      continue;
    }

    const matched = matchPricingToHandler(handler.capabilities, pricing);
    if (matched.length === 0) continue;

    const accepts = pricingToAccepts(matched, schemes);
    const args: GetRequirementsArgs = { accepts, resource: resourceInfo };

    const enriched = await handler.getRequirements(args);
    results.push(...enriched);
  }

  return results;
}

/**
 * Routes a settlement request to the appropriate handler.
 *
 * Narrows handlers by capabilities (network + asset), then iterates
 * `handleSettle` until one returns a non-null result. If a handler
 * throws, the exception propagates immediately.
 */
export async function settleX402Payment(
  handlers: FacilitatorHandler[],
  requirements: x402PaymentRequirements,
  payment: x402PaymentPayload,
): Promise<x402SettleResponse> {
  const candidates = narrowHandlers(handlers, requirements);

  for (const handler of candidates) {
    const result = await handler.handleSettle(requirements, payment);
    if (result) return result;
  }

  throw new Error(
    `no handler accepted the settlement (${candidates.length}/${handlers.length} matched capabilities)`,
  );
}

/**
 * Routes a verification request to the appropriate handler.
 *
 * Same pattern as {@link settleX402Payment} but calls `handleVerify`.
 * Handlers without `handleVerify` are skipped.
 */
export async function verifyX402Payment(
  handlers: FacilitatorHandler[],
  requirements: x402PaymentRequirements,
  payment: x402PaymentPayload,
): Promise<x402VerifyResponse> {
  const candidates = narrowHandlers(handlers, requirements);

  for (const handler of candidates) {
    if (!handler.handleVerify) continue;
    const result = await handler.handleVerify(requirements, payment);
    if (result) return result;
  }

  throw new Error(
    `no handler accepted the verification (${candidates.length}/${handlers.length} matched capabilities)`,
  );
}
