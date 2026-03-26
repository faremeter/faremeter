import type { mppChallengeParams, mppCredential, mppReceipt } from "./types";
import type { HandlerCapabilities, ResourcePricing } from "../pricing";
import { matchPricingToCapabilities } from "../pricing";

/**
 * Server-side handler for an MPP payment method.
 *
 * Named after the spec's concept of a "payment method" -- the mechanism
 * for transferring value (e.g. "solana"). A method handler supports one
 * or more intents (e.g. "charge").
 */
export interface MPPMethodHandler {
  method: string;
  capabilities: HandlerCapabilities;
  getSupportedIntents(): string[];
  getChallenge(
    intent: string,
    pricing: ResourcePricing,
    resourceURL: string,
  ): Promise<mppChallengeParams>;
  handleSettle(credential: mppCredential): Promise<mppReceipt | null>;
}

/**
 * Result of executing an MPP payment on the client side.
 */
export type MPPPaymentExecer = {
  challenge: mppChallengeParams;
  exec(): Promise<mppCredential>;
};

/**
 * Client-side handler that matches MPP challenges and produces credentials.
 *
 * Returns null when the challenge does not match this handler's method
 * or intent, allowing multiple handlers to be composed.
 */
export type MPPPaymentHandler = (
  challenge: mppChallengeParams,
) => Promise<MPPPaymentExecer | null>;

type Logger = {
  warning: (msg: string, ctx?: Record<string, unknown>) => void;
};

type ResolveOpts = {
  logger?: Logger;
};

/**
 * Generates MPP challenges by matching pricing entries to handlers.
 *
 * For each handler, matches pricing by capabilities, then calls
 * getChallenge for each matched pricing entry and each supported
 * intent. The middleware emits all challenges; the client picks one.
 */
export async function resolveMPPChallenges(
  handlers: MPPMethodHandler[],
  pricing: ResourcePricing[],
  resourceURL: string,
  opts?: ResolveOpts,
): Promise<mppChallengeParams[]> {
  const results: mppChallengeParams[] = [];

  for (const handler of handlers) {
    const matched = matchPricingToCapabilities(handler.capabilities, pricing);
    if (matched.length === 0) {
      opts?.logger?.warning(
        "no pricing matched handler capabilities for MPP challenge generation",
        { method: handler.method },
      );
      continue;
    }

    const intents = handler.getSupportedIntents();
    if (intents.length === 0) {
      opts?.logger?.warning("MPP handler declares no supported intents", {
        method: handler.method,
      });
      continue;
    }

    for (const p of matched) {
      for (const intent of intents) {
        const challenge = await handler.getChallenge(intent, p, resourceURL);
        results.push(challenge);
      }
    }
  }

  return results;
}

/**
 * Routes an MPP credential to the appropriate handler for settlement.
 *
 * Filters handlers by exact method match against the credential's
 * challenge method, then iterates handleSettle until one returns a
 * non-null result.
 */
export async function settleMPPPayment(
  handlers: MPPMethodHandler[],
  credential: mppCredential,
): Promise<mppReceipt> {
  const method = credential.challenge.method;
  const candidates = handlers.filter((h) => h.method === method);

  for (const handler of candidates) {
    const result = await handler.handleSettle(credential);
    if (result) return result;
  }

  throw new Error(`no MPP handler accepted settlement for method "${method}"`);
}
