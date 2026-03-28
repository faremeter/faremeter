import type {
  MPPMethodHandler,
  ChallengeOpts,
  mppChallengeParams,
  mppCredential,
  mppReceipt,
} from "@faremeter/types/mpp";
import {
  encodeBase64URL,
  canonicalizeSortedJSON,
  decodeBase64URL,
} from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";
import { isValidationError } from "@faremeter/types";
import {
  lookupX402Network,
  caip2ToCluster,
  type SolanaCAIP2Network,
} from "@faremeter/info/solana";
import { fetchMint } from "@solana-program/token";
import {
  address,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  type Rpc,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";
import { Keypair, PublicKey } from "@solana/web3.js";

import { mppChargeRequest, chargeCredentialPayload } from "./common";
import type { ReplayStore } from "./replay";
import { verifyChargeTransaction } from "./verify";
import { logger } from "./logger";

async function generateChallengeID(
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
  // Per spec: pipe-delimited. Safe because slot values are either
  // server-controlled constants or base64url-encoded (no pipe chars).
  const message = new TextEncoder().encode(slots.join("|"));
  const keyData = new Uint8Array(secret);
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

async function verifyChallengeID(
  secret: Uint8Array,
  params: mppChallengeParams,
): Promise<boolean> {
  const { id, ...rest } = params;
  const computed = await generateChallengeID(secret, rest);
  const encoder = new TextEncoder();
  const a = encoder.encode(computed);
  const b = encoder.encode(id);
  if (a.byteLength !== b.byteLength) return false;
  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(a, b);
}

export type CreateMPPSolanaChargeHandlerArgs = {
  network: string | SolanaCAIP2Network;
  rpc: Rpc<SolanaRpcApi>;
  feePayerKeypair: Keypair;
  mint: PublicKey;
  replayStore: ReplayStore;
  realm: string;
  secretKey: Uint8Array;
  maxRetries?: number;
  retryDelayMs?: number;
  maxPriorityFee?: number;
};

const sendTransaction = async (
  rpc: Rpc<SolanaRpcApi>,
  signedTransaction: Transaction,
  maxRetries: number,
  retryDelayMs: number,
): Promise<
  { success: true; signature: string } | { success: false; error: string }
> => {
  const base64EncodedTransaction =
    getBase64EncodedWireTransaction(signedTransaction);

  const simResult = await rpc
    .simulateTransaction(base64EncodedTransaction, {
      encoding: "base64",
    })
    .send();

  if (simResult.value.err) {
    logger.error("transaction simulation failed", simResult.value);
    return { success: false, error: "Transaction simulation failed" };
  }

  const signature = await rpc
    .sendTransaction(base64EncodedTransaction, {
      encoding: "base64",
    })
    .send();

  for (let i = 0; i < maxRetries; i++) {
    const status = await rpc.getSignatureStatuses([signature]).send();
    if (status.value[0]?.err) {
      return {
        success: false,
        error: `Transaction failed: ${JSON.stringify(status.value[0].err)}`,
      };
    }
    if (
      status.value[0]?.confirmationStatus === "confirmed" ||
      status.value[0]?.confirmationStatus === "finalized"
    ) {
      return { success: true, signature };
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { success: false, error: "Transaction confirmation timeout" };
};

export async function createMPPSolanaChargeHandler(
  args: CreateMPPSolanaChargeHandlerArgs,
): Promise<MPPMethodHandler> {
  const {
    network,
    rpc,
    feePayerKeypair,
    mint,
    replayStore,
    realm,
    secretKey,
    maxRetries = 30,
    retryDelayMs = 1000,
    maxPriorityFee = 100_000,
  } = args;

  const solanaNetwork = lookupX402Network(network);
  const mintAddress = mint.toBase58();
  const feePayerAddress = feePayerKeypair.publicKey.toBase58();

  const mintInfo = await fetchMint(rpc, address(mintAddress));
  const tokenProgram = mintInfo.programAddress;

  const feePayerSigner = await (async () => {
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");
    return createKeyPairSignerFromBytes(feePayerKeypair.secretKey);
  })();

  const getChallenge = async (
    intent: string,
    pricing: ResourcePricing,
    _resourceURL: string,
    opts?: ChallengeOpts,
  ): Promise<mppChallengeParams> => {
    const latestBlockhash = await rpc.getLatestBlockhash().send();

    const requestBody: mppChargeRequest = {
      amount: pricing.amount,
      currency: mintAddress,
      recipient: pricing.recipient,
      ...(pricing.description ? { description: pricing.description } : {}),
      methodDetails: {
        network: caip2ToCluster(solanaNetwork.caip2) ?? solanaNetwork.caip2,
        decimals: mintInfo.data.decimals,
        tokenProgram: tokenProgram as string,
        feePayer: true,
        feePayerKey: feePayerAddress,
        recentBlockhash: latestBlockhash.value.blockhash as string,
      },
    };

    const requestEncoded = encodeBase64URL(canonicalizeSortedJSON(requestBody));

    const challengeTimeoutMs = 60_000;
    const expiresAt = Date.now() + challengeTimeoutMs;

    const paramsWithoutID: Omit<mppChallengeParams, "id"> = {
      realm,
      method: "solana",
      intent,
      request: requestEncoded,
      expires: String(Math.floor(expiresAt / 1000)),
      ...(opts?.digest !== undefined ? { digest: opts.digest } : {}),
    };

    const id = await generateChallengeID(secretKey, paramsWithoutID);
    await replayStore.add(id, expiresAt);

    return { id, ...paramsWithoutID };
  };

  const handleSettle = async (
    credential: mppCredential,
  ): Promise<mppReceipt | null> => {
    const { challenge, payload } = credential;

    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    const idValid = await verifyChallengeID(secretKey, challenge);
    if (!idValid) {
      throw new Error("invalid challenge ID");
    }

    if (challenge.expires !== undefined) {
      const expiresAtMs = Number(challenge.expires) * 1000;
      if (expiresAtMs > 0 && Date.now() > expiresAtMs) {
        throw new Error("challenge expired");
      }
    }

    const consumed = await replayStore.consume(challenge.id);
    if (!consumed) {
      throw new Error("challenge ID already consumed or expired");
    }

    const validatedPayload = chargeCredentialPayload(payload);
    if (isValidationError(validatedPayload)) {
      throw new Error(
        `invalid credential payload: ${validatedPayload.summary}`,
      );
    }

    if (validatedPayload.type !== "transaction") {
      throw new Error("only pull mode (type=transaction) is supported");
    }

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      throw new Error("could not decode challenge request");
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) {
      throw new Error(`invalid charge request: ${request.summary}`);
    }

    const txBytes = getBase64Encoder().encode(validatedPayload.transaction);
    const decodedTx = getTransactionDecoder().decode(txBytes);
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(
      decodedTx.messageBytes,
    );
    const transactionMessage = decompileTransactionMessage(compiledMessage);

    const verifyResult = await verifyChargeTransaction({
      transactionMessage,
      request,
      feePayerAddress,
      tokenProgram,
      maxPriorityFee,
    });

    if ("error" in verifyResult) {
      throw new Error(`transaction verification failed: ${verifyResult.error}`);
    }

    const signedTransaction = await partiallySignTransaction(
      [feePayerSigner.keyPair],
      decodedTx,
    );

    const txResult = await sendTransaction(
      rpc,
      signedTransaction,
      maxRetries,
      retryDelayMs,
    );

    if (!txResult.success) {
      throw new Error(`settlement failed: ${txResult.error}`);
    }

    return {
      status: "success",
      method: "solana",
      timestamp: new Date().toISOString(),
      reference: txResult.signature,
    };
  };

  return {
    method: "solana",
    capabilities: {
      networks: [solanaNetwork.caip2],
      assets: [mintAddress],
    },
    getSupportedIntents: () => ["charge"],
    getChallenge,
    handleSettle,
  };
}
