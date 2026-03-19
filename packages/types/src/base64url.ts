/**
 * Base64url encoding/decoding per RFC 4648 Section 5.
 *
 * Base64url is URL-safe: uses '-' and '_' instead of '+' and '/',
 * and omits padding '=' characters.
 *
 * Uses TextEncoder/TextDecoder for proper UTF-8 support. The naive
 * btoa/atob approach only handles Latin1 (code points 0-255) and
 * throws on any non-Latin1 character.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeBase64url(input: string): string {
  const bytes = encoder.encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function decodeBase64url(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding > 0) {
    base64 += "=".repeat(4 - padding);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return decoder.decode(bytes);
}
