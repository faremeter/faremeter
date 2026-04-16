/**
 * Wraps a remote facilitator HTTP service as a `FacilitatorHandler`.
 *
 * This handler always sends v2 format requests and expects v2 responses.
 * Pointing it at a facilitator that only speaks v1 will produce validation
 * errors, which is the correct failure mode.
 */

import { isValidationError } from "@faremeter/types";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { HandlerCapabilities } from "@faremeter/types/pricing";
import {
  x402SettleResponseLenient,
  normalizeSettleResponse,
  x402VerifyResponseLenient,
  normalizeVerifyResponse,
} from "@faremeter/types/x402";
import {
  type x402PaymentRequirements,
  x402PaymentRequiredResponse,
  x402SettleResponse as x402SettleResponseValidator,
  x402VerifyResponse as x402VerifyResponseValidator,
} from "@faremeter/types/x402v2";
import type {
  x402SettleResponse,
  x402VerifyResponse,
} from "@faremeter/types/x402v2";
import {
  adaptSettleResponseLenientToV2,
  adaptVerifyResponseV1ToV2,
} from "@faremeter/types/x402-adapters";
import type { AgedLRUCacheOpts } from "./cache";
import { AgedLRUCache } from "./cache";

import { logger } from "./logger";

type CreateHTTPFacilitatorHandlerOpts = {
  capabilities: HandlerCapabilities;
  fetch?: typeof fetch;
  cacheConfig?: AgedLRUCacheOpts & { disable?: boolean };
  /**
   * Original accepts to forward to the facilitator's /accepts endpoint.
   * When provided, getRequirements sends these instead of the glue
   * layer's constructed accepts. This preserves fields like `extra`
   * that ResourcePricing does not carry.
   *
   * This is backward-compat debt for the facilitatorURL path. It can be
   * removed when all callers migrate to in-process handlers or when the
   * facilitator accepts ResourcePricing natively.
   */
  acceptsOverride?: Partial<x402PaymentRequirements>[];
};

/**
 * Creates a `FacilitatorHandler` that delegates to a remote facilitator
 * via HTTP.
 *
 * The glue layer constructs valid `x402PaymentRequirements` from
 * `ResourcePricing` using `capabilities.schemes`, then passes them to
 * `getRequirements`. This handler POSTs those to the facilitator's
 * `/accepts` endpoint for enrichment.
 *
 * Cache key stability: caching assumes that identical `accepts` arrays
 * produce identical facilitator responses. If the facilitator returns
 * time-dependent values (e.g. `recentBlockhash`), use a short `maxAge`
 * or disable caching.
 */
export function createHTTPFacilitatorHandler(
  facilitatorURL: string,
  opts: CreateHTTPFacilitatorHandlerOpts,
): FacilitatorHandler {
  const fetchFn = opts.fetch ?? fetch;
  const cache = createAcceptsCache(opts.cacheConfig);
  const acceptsOverride = opts.acceptsOverride;

  return {
    capabilities: opts.capabilities,

    async getRequirements(args) {
      const acceptsToSend = acceptsOverride ?? args.accepts;
      const cacheKey = cache ? JSON.stringify(acceptsToSend) : "";
      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached) return cached;
      }

      const response = await fetchFn(`${facilitatorURL}/accepts`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          x402Version: 2,
          resource: args.resource ?? { url: "" },
          accepts: acceptsToSend,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `facilitator /accepts returned ${response.status}: ${response.statusText}`,
        );
      }

      const parsed = x402PaymentRequiredResponse(await response.json());
      if (isValidationError(parsed)) {
        throw new Error(
          `invalid response from facilitator /accepts: ${parsed.summary}`,
        );
      }

      if (cache) {
        cache.put(cacheKey, parsed.accepts);
      }

      return parsed.accepts;
    },

    async handleSettle(requirements, payment) {
      const response = await fetchFn(`${facilitatorURL}/settle`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentRequirements: requirements,
          paymentPayload: payment,
        }),
      });

      // Try to parse the body even on non-200 responses -- facilitators
      // may return a 500 with a valid error body (e.g. { success: false }).
      const raw = await safeJSON(response, "/settle");
      return parseSettleResponse(response, raw);
    },

    async handleVerify(requirements, payment) {
      const response = await fetchFn(`${facilitatorURL}/verify`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentRequirements: requirements,
          paymentPayload: payment,
        }),
      });

      const raw = await safeJSON(response, "/verify");
      return parseVerifyResponse(response, raw);
    },
  };
}

async function safeJSON(
  response: Response,
  endpoint: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(
      `facilitator ${endpoint} returned non-JSON response (${response.status}: ${response.statusText})`,
    );
  }
}

function parseSettleResponse(
  response: Response,
  raw: unknown,
): x402SettleResponse {
  // Try strict v2 first
  const v2 = x402SettleResponseValidator(raw);
  if (!isValidationError(v2)) return v2;

  // Fall back to lenient v1 parsing for backward compat with older facilitators
  const lenient = x402SettleResponseLenient(raw);
  if (!isValidationError(lenient)) {
    const normalized = normalizeSettleResponse(lenient);
    return adaptSettleResponseLenientToV2(normalized);
  }

  if (!response.ok) {
    throw new Error(
      `facilitator /settle returned ${response.status}: ${response.statusText}`,
    );
  }

  throw new Error(`invalid response from facilitator /settle: ${v2.summary}`);
}

function parseVerifyResponse(
  response: Response,
  raw: unknown,
): x402VerifyResponse {
  const v2 = x402VerifyResponseValidator(raw);
  if (!isValidationError(v2)) return v2;

  const lenient = x402VerifyResponseLenient(raw);
  if (!isValidationError(lenient)) {
    const normalized = normalizeVerifyResponse(lenient);
    return adaptVerifyResponseV1ToV2(normalized);
  }

  if (!response.ok) {
    throw new Error(
      `facilitator /verify returned ${response.status}: ${response.statusText}`,
    );
  }

  throw new Error(`invalid response from facilitator /verify: ${v2.summary}`);
}

function createAcceptsCache(
  opts?: AgedLRUCacheOpts & { disable?: boolean },
): AgedLRUCache<string, x402PaymentRequirements[]> | null {
  if (!opts || opts.disable) {
    return null;
  }

  logger.debug("HTTP facilitator handler accepts cache enabled");
  return new AgedLRUCache(opts);
}
