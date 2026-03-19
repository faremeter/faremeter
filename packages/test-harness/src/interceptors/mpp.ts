import type { Interceptor } from "./types";
import { x402PaymentRequiredResponse } from "@faremeter/types/x402";
import { isValidationError, base64url } from "@faremeter/types";
import { adaptPaymentRequiredResponseV1ToV2 } from "@faremeter/types/x402-adapters";
import { normalizeNetworkId } from "@faremeter/info";

const { encodeBase64url } = base64url;

/**
 * Creates an interceptor that transforms v1 402 responses to MPP challenge
 * format (WWW-Authenticate: Payment header).
 *
 * This allows testing the full MPP client flow by making the middleware
 * appear to respond with an MPP challenge even though it generates x402
 * payment-required responses internally.
 *
 * The transformation:
 * - Parses the JSON body as v1 PaymentRequiredResponse
 * - Converts to v2 PaymentRequiredResponse to get normalized fields
 * - Builds an MPP challenge from the first accepted requirement
 * - Returns 402 with WWW-Authenticate: Payment header
 */
export function createMPPResponseInterceptor(): Interceptor {
  return (baseFetch) => async (input, init) => {
    const response = await baseFetch(input, init);

    if (response.status !== 402) {
      return response;
    }

    const cloned = response.clone();
    let body: unknown;
    try {
      body = await cloned.json();
    } catch {
      return response;
    }

    const v1Response = x402PaymentRequiredResponse(body);
    if (isValidationError(v1Response)) {
      return response;
    }

    const resourceURL = v1Response.accepts[0]?.resource ?? "";
    const v2Response = adaptPaymentRequiredResponseV1ToV2(
      v1Response,
      resourceURL,
      normalizeNetworkId,
    );

    const firstAccept = v2Response.accepts[0];
    if (!firstAccept) {
      return response;
    }

    const chargeRequest = {
      amount: firstAccept.amount,
      currency: firstAccept.asset,
      recipient: firstAccept.payTo,
      methodDetails: {
        network: firstAccept.network,
        ...(firstAccept.extra ?? {}),
      },
    };

    const requestParam = encodeBase64url(JSON.stringify(chargeRequest));

    const challengeId = `mpp-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const expires = new Date(
      Date.now() + (firstAccept.maxTimeoutSeconds ?? 300) * 1000,
    ).toISOString();

    const wwwAuth =
      `Payment ` +
      `id="${challengeId}", ` +
      `realm="test-harness", ` +
      `method="${firstAccept.scheme}", ` +
      `intent="charge", ` +
      `request="${requestParam}", ` +
      `expires="${expires}"`;

    const newHeaders = new Headers();
    newHeaders.set("WWW-Authenticate", wwwAuth);

    return new Response(null, {
      status: 402,
      statusText: "Payment Required",
      headers: newHeaders,
    });
  };
}
