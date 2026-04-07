import type {
  MPPMethodHandler,
  MPPPaymentHandler,
  MPPPaymentExecer,
  mppChallengeParams,
  mppCredential,
} from "@faremeter/types/mpp";
import {
  encodeBase64URL,
  canonicalizeSortedJSON,
  decodeBase64URL,
} from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";

export const TEST_MPP_METHOD = "test-solana";
export const TEST_MPP_INTENT = "charge";
export const TEST_MPP_REALM = "test-realm";
export const TEST_MPP_SECRET = new TextEncoder().encode(
  "test-mpp-secret-key-for-harness",
);

async function generateTestChallengeID(
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
  const keyData = new Uint8Array(TEST_MPP_SECRET);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return encodeBase64URL(String.fromCharCode(...new Uint8Array(sig)));
}

export type CreateTestMPPHandlerOpts = {
  method?: string;
  realm?: string;
  intents?: string[];
  onChallenge?: (
    intent: string,
    pricing: ResourcePricing,
    resourceURL: string,
  ) => void;
  onSettle?: (credential: mppCredential) => void;
};

export function createTestMPPHandler(
  opts: CreateTestMPPHandlerOpts = {},
): MPPMethodHandler {
  const method = opts.method ?? TEST_MPP_METHOD;
  const realm = opts.realm ?? TEST_MPP_REALM;
  const intents = opts.intents ?? [TEST_MPP_INTENT];
  const challengeStore = new Map<string, boolean>();

  return {
    method,
    capabilities: {
      networks: [],
      assets: [],
    },
    getSupportedIntents: () => intents,
    getChallenge: async (intent, pricing, resourceURL, challengeOpts?) => {
      opts.onChallenge?.(intent, pricing, resourceURL);

      const requestBody = {
        amount: pricing.amount,
        currency: pricing.asset,
        recipient: pricing.recipient,
      };
      const requestEncoded = encodeBase64URL(
        canonicalizeSortedJSON(requestBody),
      );

      const paramsWithoutID: Omit<mppChallengeParams, "id"> = {
        realm,
        method,
        intent,
        request: requestEncoded,
        ...(challengeOpts?.digest !== undefined
          ? { digest: challengeOpts.digest }
          : {}),
      };

      const id = await generateTestChallengeID(paramsWithoutID);
      challengeStore.set(id, true);

      return { id, ...paramsWithoutID };
    },
    handleSettle: async (credential) => {
      opts.onSettle?.(credential);

      if (credential.challenge.method !== method) return null;

      if (!challengeStore.has(credential.challenge.id)) {
        throw new Error("unknown or consumed challenge ID");
      }
      challengeStore.delete(credential.challenge.id);

      return {
        status: "success" as const,
        method,
        intent: credential.challenge.intent,
        timestamp: new Date().toISOString(),
        reference: `test-tx-${Date.now()}`,
      };
    },
  };
}

export type CreateTestMPPPaymentHandlerOpts = {
  method?: string;
  intent?: string;
  onMatch?: (challenge: mppChallengeParams) => void;
  onExec?: (challenge: mppChallengeParams) => void;
};

export function createTestMPPPaymentHandler(
  opts: CreateTestMPPPaymentHandlerOpts = {},
): MPPPaymentHandler {
  const method = opts.method ?? TEST_MPP_METHOD;
  const intent = opts.intent ?? TEST_MPP_INTENT;

  return async (
    challenge: mppChallengeParams,
  ): Promise<MPPPaymentExecer | null> => {
    if (challenge.method !== method) return null;
    if (challenge.intent !== intent) return null;

    opts.onMatch?.(challenge);

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        opts.onExec?.(challenge);

        let requestBody: Record<string, unknown> = {};
        try {
          requestBody = JSON.parse(
            decodeBase64URL(challenge.request),
          ) as Record<string, unknown>;
        } catch {
          // use empty object if decode fails
        }

        return {
          challenge,
          payload: {
            type: "transaction",
            transaction: "dGVzdC10cmFuc2FjdGlvbg",
            ...requestBody,
          },
        };
      },
    };
  };
}
