import type { mppChallengeParams, mppCredential, mppReceipt } from "./mpp";
import {
  mppChargeRequest as mppChargeRequestValidator,
  mppReceipt as mppReceiptValidator,
  mppChallengeParams as mppChallengeParamsValidator,
  isSupportedIntent,
} from "./mpp";
import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
} from "./x402v2";
import {
  x402PaymentRequirements as x402PaymentRequirementsValidator,
  x402PaymentPayload as x402PaymentPayloadValidator,
} from "./x402v2";
import { isValidationError } from "./validation";
import { decodeBase64url, encodeBase64url } from "./base64url";

/**
 * Convert MPP challenge to x402v2 requirements (EPHEMERAL).
 *
 * This creates a temporary x402v2 object for calling payment handlers.
 * The caller MUST keep the original mppChallengeParams in scope for:
 * - Building the MPP credential (requires full challenge object)
 * - Checking expiry (challenge.expires)
 * - Other validation as needed
 *
 * Only payment-relevant fields are converted. MPP protocol metadata
 * (id, realm, intent, opaque, digest, description) is NOT included
 * in the x402v2 object - it stays in the original MPP challenge.
 *
 * @param challenge - Validated MPP challenge parameters
 * @returns x402v2 payment requirements (ephemeral, for handler input only)
 */
export function mppChallengeToX402Requirements(
  challenge: mppChallengeParams,
): x402PaymentRequirements {
  const requestJSON = decodeBase64url(challenge.request);
  const requestData = JSON.parse(requestJSON) as unknown;
  const request = mppChargeRequestValidator(requestData);

  if (isValidationError(request)) {
    throw new Error(`Invalid MPP charge request: ${request.summary}`);
  }

  if (!isSupportedIntent(challenge.intent)) {
    throw new Error(`Unsupported MPP intent: ${challenge.intent}`);
  }

  if (!request.recipient) {
    throw new Error("MPP challenge request missing required recipient");
  }

  const network = extractNetworkFromMethodDetails(
    challenge.method,
    request.methodDetails,
  );

  const result = x402PaymentRequirementsValidator({
    scheme: challenge.method,
    network,
    amount: request.amount,
    asset: request.currency,
    payTo: request.recipient,
    maxTimeoutSeconds: calculateTimeout(challenge.expires),
    extra: request.methodDetails,
  });

  if (isValidationError(result)) {
    throw new Error(`Invalid x402 requirements: ${result.summary}`);
  }

  return result;
}

/**
 * Convert MPP credential to x402v2 payload (EPHEMERAL).
 *
 * This creates a temporary x402v2 object for calling the facilitator.
 * The caller MUST keep the original mppCredential in scope for:
 * - Validating challenge expiry (credential.challenge.expires)
 * - Verifying request digest (credential.challenge.digest)
 * - Replay protection (credential.challenge.id)
 * - Correlation (credential.challenge.opaque)
 * - Logging/audit (credential.source)
 * - Building the MPP receipt (credential.challenge.method)
 *
 * MPP protocol metadata is NOT sent to the facilitator - middleware
 * uses it directly from the original credential.
 *
 * @param credential - Validated MPP credential
 * @returns x402v2 payment payload (ephemeral, for facilitator input only)
 */
export function mppCredentialToX402Payload(
  credential: mppCredential,
): x402PaymentPayload {
  const requirements = mppChallengeToX402Requirements(credential.challenge);

  const result = x402PaymentPayloadValidator({
    x402Version: 2,
    accepted: requirements,
    payload: credential.payload,
  });

  if (isValidationError(result)) {
    throw new Error(`Invalid x402 payload: ${result.summary}`);
  }

  return result;
}

/**
 * Convert x402v2 settle response to MPP receipt.
 *
 * Used by middleware to build the Payment-Receipt header.
 * The method parameter comes from the original MPP credential
 * (not from the x402 settlement response).
 *
 * @param response - Validated x402v2 settle response
 * @param method - Payment method (from original credential.challenge.method)
 * @returns MPP receipt
 */
export function x402SettleToMPPReceipt(
  response: x402SettleResponse,
  method: string,
): mppReceipt {
  if (!response.success) {
    throw new Error(
      `Settlement failed: ${response.errorReason ?? "unknown error"}`,
    );
  }

  const result = mppReceiptValidator({
    status: "success",
    method,
    timestamp: new Date().toISOString(),
    reference: response.transaction,
  });

  if (isValidationError(result)) {
    throw new Error(`Invalid MPP receipt: ${result.summary}`);
  }

  return result;
}

/**
 * Parse WWW-Authenticate: Payment header into MPP challenge params.
 *
 * Format: Payment realm="...", method="...", intent="...", request="..."
 *
 * @param headerValue - The full WWW-Authenticate header value
 * @returns Validated MPP challenge parameters
 */
export function parseMPPChallenge(headerValue: string): mppChallengeParams {
  if (!headerValue.toLowerCase().startsWith("payment ")) {
    throw new Error("Invalid MPP challenge: must start with 'Payment '");
  }

  const paramsStr = headerValue.substring("payment ".length);

  // Limitations:
  // 1. Does not handle RFC 9110 quoted-string escaping (e.g., \" within
  //    values). Acceptable because description/opaque are optional and
  //    critical fields (id, realm, method, intent, request) are simple
  //    tokens or base64url strings that never contain quotes.
  // 2. Does not handle unquoted token values (e.g., key=value without
  //    quotes). Per RFC 9110, auth-param values can be either tokens or
  //    quoted-strings. A non-spec-compliant server sending unquoted
  //    values would produce empty params and a validation error.
  // If either becomes a problem, replace with a proper RFC 9110 parser.
  const params: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(paramsStr)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) {
      params[key] = value;
    }
  }

  const result = mppChallengeParamsValidator(params);

  if (isValidationError(result)) {
    throw new Error(`Invalid MPP challenge params: ${result.summary}`);
  }

  return result;
}

/**
 * Format MPP credential for Authorization header.
 *
 * Per MPP Spec Section 5.2: base64url-encoded JSON without padding.
 *
 * @param credential - Validated MPP credential
 * @returns Base64url-encoded JSON for Authorization: Payment header value
 */
export function formatMPPCredential(credential: mppCredential): string {
  return encodeBase64url(JSON.stringify(credential));
}

/**
 * Calculate timeout in seconds from ISO 8601 expires timestamp.
 *
 * Throws if the challenge has already expired. Producing a zero or
 * negative timeout would result in undefined behavior downstream.
 *
 * @param expires - Optional ISO 8601 timestamp
 * @returns Timeout in seconds (default 300 if no expires)
 */
function calculateTimeout(expires?: string): number {
  if (!expires) return 300;
  const expiryTime = new Date(expires).getTime();
  const now = Date.now();
  const timeout = Math.floor((expiryTime - now) / 1000);
  if (timeout <= 0) {
    throw new Error("MPP challenge has expired");
  }
  return timeout;
}

/**
 * Extract network from method-specific methodDetails.
 *
 * Per FAREMETER_MPP_METHOD_SPEC.md, the `network` field is required
 * and must be in CAIP-2 format. No legacy fallbacks.
 *
 * @param method - Payment method identifier
 * @param methodDetails - Method-specific details object
 * @returns CAIP-2 network identifier
 */
function extractNetworkFromMethodDetails(
  method: string,
  methodDetails: unknown,
): string {
  if (!methodDetails || typeof methodDetails !== "object") {
    throw new Error(`MPP method ${method} missing methodDetails`);
  }

  if ("network" in methodDetails && typeof methodDetails.network === "string") {
    return methodDetails.network;
  }

  throw new Error(
    `MPP method ${method} methodDetails missing required network field`,
  );
}
