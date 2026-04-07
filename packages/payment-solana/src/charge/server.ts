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
  generateChallengeID,
  verifyChallengeID,
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
  type Signature,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import type { CompilableTransactionMessage } from "../common";
import { mppChargeRequest, chargeCredentialPayload } from "./common";
import type { ReplayStore } from "./replay";
import {
  verifyChargeTransaction,
  verifyNativeChargeTransaction,
} from "./verify";
import { logger } from "./logger";

export type CreateMPPSolanaChargeHandlerArgs = {
  network: string | SolanaCAIP2Network;
  rpc: Rpc<SolanaRpcApi>;
  feePayerKeypair?: Keypair;
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

const fetchConfirmedTransaction = async (
  rpc: Rpc<SolanaRpcApi>,
  signature: string,
  maxRetries: number,
  retryDelayMs: number,
): Promise<CompilableTransactionMessage | null> => {
  for (let i = 0; i < maxRetries; i++) {
    const result = await rpc
      .getTransaction(signature as Signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
        encoding: "base64",
      })
      .send();

    if (result !== null) {
      if (result.meta?.err) {
        throw new Error(
          `on-chain transaction failed: ${JSON.stringify(result.meta.err)}`,
        );
      }

      const txData = result.transaction;
      const txB64 = Array.isArray(txData) ? txData[0] : txData;
      if (typeof txB64 !== "string") {
        throw new Error("unexpected transaction encoding in RPC response");
      }
      const txBytes = getBase64Encoder().encode(txB64);
      const decodedTx = getTransactionDecoder().decode(txBytes);
      const compiledMessage = getCompiledTransactionMessageDecoder().decode(
        decodedTx.messageBytes,
      );
      return decompileTransactionMessage(compiledMessage);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  return null;
};

const decodeWireTransaction = (base64Transaction: string) => {
  const txBytes = getBase64Encoder().encode(base64Transaction);
  const decodedTx = getTransactionDecoder().decode(txBytes);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    decodedTx.messageBytes,
  );
  return {
    transactionMessage: decompileTransactionMessage(compiledMessage),
    decodedTx,
  };
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
  const hasFeePayerKeypair = feePayerKeypair !== undefined;
  const feePayerAddress = feePayerKeypair?.publicKey.toBase58();

  const mintInfo = await fetchMint(rpc, address(mintAddress));
  const tokenProgram = mintInfo.programAddress;

  const feePayerSigner = hasFeePayerKeypair
    ? await (async () => {
        const { createKeyPairSignerFromBytes } = await import("@solana/kit");
        return createKeyPairSignerFromBytes(feePayerKeypair.secretKey);
      })()
    : null;

  const getChallenge = async (
    intent: string,
    pricing: ResourcePricing,
    _resourceURL: string,
    opts?: ChallengeOpts,
  ): Promise<mppChallengeParams> => {
    const methodDetails: mppChargeRequest["methodDetails"] = {
      network: caip2ToCluster(solanaNetwork.caip2) ?? solanaNetwork.caip2,
      decimals: mintInfo.data.decimals,
      tokenProgram: tokenProgram as string,
    };

    if (hasFeePayerKeypair && feePayerAddress) {
      const latestBlockhash = await rpc.getLatestBlockhash().send();
      methodDetails.feePayer = true;
      methodDetails.feePayerKey = feePayerAddress;
      methodDetails.recentBlockhash = latestBlockhash.value.blockhash as string;
    }

    const requestBody: mppChargeRequest = {
      amount: pricing.amount,
      currency: mintAddress,
      recipient: pricing.recipient,
      ...(pricing.description ? { description: pricing.description } : {}),
      methodDetails,
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

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency === "sol") return null;

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

    const verifyArgs = {
      request,
      feePayerAddress: feePayerAddress ?? "",
      tokenProgram,
      maxPriorityFee,
    };

    if (validatedPayload.type === "signature") {
      if (request.methodDetails?.feePayer) {
        throw new Error("push mode is not allowed with fee sponsorship");
      }

      const transactionMessage = await fetchConfirmedTransaction(
        rpc,
        validatedPayload.signature,
        maxRetries,
        retryDelayMs,
      );

      if (!transactionMessage) {
        throw new Error("could not fetch confirmed transaction");
      }

      const verifyResult = await verifyChargeTransaction({
        transactionMessage,
        ...verifyArgs,
      });

      if ("error" in verifyResult) {
        throw new Error(
          `transaction verification failed: ${verifyResult.error}`,
        );
      }

      return {
        status: "success",
        method: "solana",
        timestamp: new Date().toISOString(),
        reference: validatedPayload.signature,
      };
    }

    const { transactionMessage, decodedTx } = decodeWireTransaction(
      validatedPayload.transaction,
    );

    const verifyResult = await verifyChargeTransaction({
      transactionMessage,
      ...verifyArgs,
    });

    if ("error" in verifyResult) {
      throw new Error(`transaction verification failed: ${verifyResult.error}`);
    }

    if (!feePayerSigner) {
      throw new Error("pull mode requires a fee payer keypair");
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

const SOL_DECIMALS = Math.log10(LAMPORTS_PER_SOL);

export type CreateMPPSolanaNativeChargeHandlerArgs = {
  network: string | SolanaCAIP2Network;
  rpc: Rpc<SolanaRpcApi>;
  feePayerKeypair?: Keypair;
  replayStore: ReplayStore;
  realm: string;
  secretKey: Uint8Array;
  maxRetries?: number;
  retryDelayMs?: number;
  maxPriorityFee?: number;
};

export async function createMPPSolanaNativeChargeHandler(
  args: CreateMPPSolanaNativeChargeHandlerArgs,
): Promise<MPPMethodHandler> {
  const {
    network,
    rpc,
    feePayerKeypair,
    replayStore,
    realm,
    secretKey,
    maxRetries = 30,
    retryDelayMs = 1000,
    maxPriorityFee = 100_000,
  } = args;

  const solanaNetwork = lookupX402Network(network);
  const hasFeePayerKeypair = feePayerKeypair !== undefined;
  const feePayerAddress = feePayerKeypair?.publicKey.toBase58();

  const feePayerSigner = hasFeePayerKeypair
    ? await (async () => {
        const { createKeyPairSignerFromBytes } = await import("@solana/kit");
        return createKeyPairSignerFromBytes(feePayerKeypair.secretKey);
      })()
    : null;

  const getChallenge = async (
    intent: string,
    pricing: ResourcePricing,
    _resourceURL: string,
    opts?: ChallengeOpts,
  ): Promise<mppChallengeParams> => {
    const methodDetails: mppChargeRequest["methodDetails"] = {
      network: caip2ToCluster(solanaNetwork.caip2) ?? solanaNetwork.caip2,
      decimals: SOL_DECIMALS,
    };

    if (hasFeePayerKeypair && feePayerAddress) {
      const latestBlockhash = await rpc.getLatestBlockhash().send();
      methodDetails.feePayer = true;
      methodDetails.feePayerKey = feePayerAddress;
      methodDetails.recentBlockhash = latestBlockhash.value.blockhash as string;
    }

    const requestBody: mppChargeRequest = {
      amount: pricing.amount,
      currency: "sol",
      recipient: pricing.recipient,
      ...(pricing.description ? { description: pricing.description } : {}),
      methodDetails,
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

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency !== "sol") return null;

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

    const verifyArgs = {
      request,
      feePayerAddress: feePayerAddress ?? "",
      maxPriorityFee,
    };

    if (validatedPayload.type === "signature") {
      if (request.methodDetails?.feePayer) {
        throw new Error("push mode is not allowed with fee sponsorship");
      }

      const transactionMessage = await fetchConfirmedTransaction(
        rpc,
        validatedPayload.signature,
        maxRetries,
        retryDelayMs,
      );

      if (!transactionMessage) {
        throw new Error("could not fetch confirmed transaction");
      }

      const verifyResult = await verifyNativeChargeTransaction({
        transactionMessage,
        ...verifyArgs,
      });

      if ("error" in verifyResult) {
        throw new Error(
          `transaction verification failed: ${verifyResult.error}`,
        );
      }

      return {
        status: "success",
        method: "solana",
        timestamp: new Date().toISOString(),
        reference: validatedPayload.signature,
      };
    }

    const { transactionMessage, decodedTx } = decodeWireTransaction(
      validatedPayload.transaction,
    );

    const verifyResult = await verifyNativeChargeTransaction({
      transactionMessage,
      ...verifyArgs,
    });

    if ("error" in verifyResult) {
      throw new Error(`transaction verification failed: ${verifyResult.error}`);
    }

    if (!feePayerSigner) {
      throw new Error("pull mode requires a fee payer keypair");
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
      assets: ["sol"],
    },
    getSupportedIntents: () => ["charge"],
    getChallenge,
    handleSettle,
  };
}
