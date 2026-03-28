import { isValidationError } from "../validation";
import { mppChallengeParams, mppCredential, mppReceipt } from "./types";
import type {
  mppChallengeParams as MppChallengeParams,
  mppCredential as MppCredential,
  mppReceipt as MppReceipt,
} from "./types";

export function encodeBase64URL(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeBase64URL(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const paddedLength = padded.length + ((4 - (padded.length % 4)) % 4);
  const binary = atob(padded.padEnd(paddedLength, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Sorted-key JSON canonicalization following RFC 8785 JCS for the
 * subset of inputs used by MPP (string keys, no integer-indexed
 * properties). Integer-indexed keys would violate RFC 8785 sort order
 * due to ECMAScript property enumeration rules.
 */
export function canonicalizeSortedJSON(obj: unknown): string {
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`non-finite number in JCS input: ${String(value)}`);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

function quoteParam(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatWWWAuthenticate(
  challenges: MppChallengeParams[],
): string {
  return challenges
    .map((c) => {
      const parts = [
        `Payment id=${quoteParam(c.id)}`,
        `realm=${quoteParam(c.realm)}`,
        `method=${quoteParam(c.method)}`,
        `intent=${quoteParam(c.intent)}`,
        `request=${quoteParam(c.request)}`,
      ];
      if (c.expires !== undefined)
        parts.push(`expires=${quoteParam(c.expires)}`);
      if (c.description !== undefined)
        parts.push(`description=${quoteParam(c.description)}`);
      if (c.opaque !== undefined) parts.push(`opaque=${quoteParam(c.opaque)}`);
      if (c.digest !== undefined) parts.push(`digest=${quoteParam(c.digest)}`);
      return parts.join(", ");
    })
    .join(", ");
}

function unquoteParam(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

/**
 * Parses a WWW-Authenticate header value containing one or more Payment
 * challenges. Each challenge starts with the token "Payment" followed by
 * auth-param key=value pairs.
 */
export function parseWWWAuthenticate(header: string): MppChallengeParams[] {
  const challenges: MppChallengeParams[] = [];
  const challengeRegex =
    /Payment\s+((?:[a-zA-Z][a-zA-Z0-9]*\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^\s,]+)(?:\s*,\s*(?=[a-zA-Z][a-zA-Z0-9]*\s*=))?)+)/gi;

  let match: RegExpExecArray | null;
  while ((match = challengeRegex.exec(header)) !== null) {
    const paramsStr = match[1];
    if (!paramsStr) continue;

    const params: Record<string, string> = {};
    const paramRegex =
      /([a-zA-Z][a-zA-Z0-9]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s,]+)/g;

    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
      const key = paramMatch[1];
      const value = paramMatch[2];
      if (key && value) {
        params[key] = unquoteParam(value);
      }
    }

    const validated = mppChallengeParams(params);
    if (!isValidationError(validated)) {
      challenges.push(validated);
    }
  }

  return challenges;
}

export function parseAuthorizationPayment(
  header: string,
): MppCredential | undefined {
  const prefix = header.slice(0, 8);
  if (prefix.toLowerCase() !== "payment ") return undefined;

  const token = header.slice(8).trim();

  let decoded: string;
  try {
    decoded = decodeBase64URL(token);
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return undefined;
  }

  const validated = mppCredential(parsed);
  if (isValidationError(validated)) return undefined;

  return validated;
}

export function serializeCredential(credential: MppCredential): string {
  return encodeBase64URL(canonicalizeSortedJSON(credential));
}

export function serializeReceipt(receipt: MppReceipt): string {
  return encodeBase64URL(canonicalizeSortedJSON(receipt));
}

/**
 * Computes an RFC 9530 content digest for a request body.
 * Format: `sha-256=:base64value:`
 */
export async function computeBodyDigest(body: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", body);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `sha-256=:${base64}:`;
}

export function parseReceipt(header: string): MppReceipt | undefined {
  let decoded: string;
  try {
    decoded = decodeBase64URL(header);
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return undefined;
  }

  const validated = mppReceipt(parsed);
  if (isValidationError(validated)) return undefined;

  return validated;
}
