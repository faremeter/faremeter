import { encodeBase64URL } from "./encoding";
import type { mppChallengeParams } from "./types";

/**
 * Computes the HMAC-SHA256 challenge ID for a set of challenge
 * parameters. The ID commits the server's realm, method, intent,
 * request, and optional expires/digest/opaque fields under a shared
 * secret. Used by method handlers to verify that a presented challenge
 * was minted by the same server without any out-of-band state.
 *
 * Slot values are either server-controlled constants or base64url
 * strings, so the pipe delimiter is safe.
 */
export async function generateChallengeID(
  secret: Uint8Array,
  params: Omit<mppChallengeParams, "id">,
): Promise<string> {
  const slots = [
    params.realm,
    params.method,
    params.intent,
    params.request,
    params.expires ?? "",
    params.digest ?? "",
    params.opaque ?? "",
  ];
  const message = new TextEncoder().encode(slots.join("|"));
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return encodeBase64URL(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * Constant-time comparison of two byte arrays. Avoids the node:crypto
 * dependency so this module works in any runtime with Web Crypto.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) return false;
    diff |= av ^ bv;
  }
  return diff === 0;
}

/**
 * Recomputes the challenge ID from the other parameters and compares
 * it to the presented ID in constant time.
 */
export async function verifyChallengeID(
  secret: Uint8Array,
  params: mppChallengeParams,
): Promise<boolean> {
  const { id, ...rest } = params;
  const computed = await generateChallengeID(secret, rest);
  const encoder = new TextEncoder();
  return constantTimeEqual(encoder.encode(computed), encoder.encode(id));
}
