import type {
  MPPMethodHandler,
  ChallengeOpts,
  MPPHandlerContext,
  mppChallengeParams,
  mppCredential,
  mppReceipt,
} from "@faremeter/types/mpp";
import {
  encodeBase64URL,
  canonicalizeSortedJSON,
  decodeBase64URL,
  formatMPPDateTime,
  parseMPPExpiresAtMs,
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
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  type Address,
  type KeyPairSigner,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";

const SIGNATURE_REPLAY_PREFIX = "solana-charge:consumed:";
const SIGNATURE_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const CHARGE_CHALLENGE_TIMEOUT_MS = 60_000;
const SIGNATURE_BLOCK_TIME_CLOCK_SKEW_MS = 5_000;

import type { CompilableTransactionMessage } from "../common";
import { mppChargeRequest, chargeCredentialPayload } from "./common";
import type { ReplayStore } from "./replay";
import {
  verifyChargeTransaction,
  verifyNativeChargeTransaction,
} from "./verify";
import { logger } from "./logger";
import { toAddress, toKeyPairSigner, toRpc } from "../compat";

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
  rpc: Rpc<SolanaRpcApi> | string;
  feePayerSigner?:
    | KeyPairSigner
    | { secretKey: Uint8Array; publicKey: { toBase58(): string } };
  mint: Address | { toBase58(): string };
  replayStore: ReplayStore;
  realm: string;
  secretKey: Uint8Array;
  maxRetries?: number;
  retryDelayMs?: number;
  maxPriorityFee?: number;
};

type SendTransactionResult =
  | { success: true; signature: Signature }
  | { success: false; error: string; submitted: boolean };

type ConfirmedChargeTransaction = {
  transactionMessage: CompilableTransactionMessage;
  blockTime: number | bigint | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sendTransaction = async (
  rpc: Rpc<SolanaRpcApi>,
  signedTransaction: Transaction,
  maxRetries: number,
  retryDelayMs: number,
): Promise<SendTransactionResult> => {
  const base64EncodedTransaction =
    getBase64EncodedWireTransaction(signedTransaction);

  try {
    const simResult = await rpc
      .simulateTransaction(base64EncodedTransaction, {
        encoding: "base64",
      })
      .send();

    if (simResult.value.err) {
      logger.error("transaction simulation failed", simResult.value);
      return {
        success: false,
        submitted: false,
        error: "Transaction simulation failed",
      };
    }
  } catch (error) {
    return {
      success: false,
      submitted: false,
      error: `Transaction simulation failed: ${getErrorMessage(error)}`,
    };
  }

  let signature: Signature;
  try {
    signature = await rpc
      .sendTransaction(base64EncodedTransaction, {
        encoding: "base64",
      })
      .send();
  } catch (error) {
    return {
      success: false,
      submitted: false,
      error: `Transaction send failed: ${getErrorMessage(error)}`,
    };
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      const status = await rpc.getSignatureStatuses([signature]).send();
      if (status.value[0]?.err) {
        return {
          success: false,
          submitted: true,
          error: `Transaction failed: ${JSON.stringify(status.value[0].err)}`,
        };
      }
      if (
        status.value[0]?.confirmationStatus === "confirmed" ||
        status.value[0]?.confirmationStatus === "finalized"
      ) {
        return { success: true, signature };
      }
    } catch (error) {
      return {
        success: false,
        submitted: true,
        error: `Transaction confirmation failed: ${getErrorMessage(error)}`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return {
    success: false,
    submitted: true,
    error: "Transaction confirmation timeout",
  };
};

const fetchConfirmedTransaction = async (
  rpc: Rpc<SolanaRpcApi>,
  signature: string,
  maxRetries: number,
  retryDelayMs: number,
): Promise<ConfirmedChargeTransaction | null> => {
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
      assertNoAddressLookupTables(compiledMessage);
      return {
        transactionMessage: decompileTransactionMessage(compiledMessage),
        blockTime: getRPCBlockTime(result),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  return null;
};

function getRPCBlockTime(result: unknown): number | bigint | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  if (!("blockTime" in result)) {
    return null;
  }
  const { blockTime } = result;
  if (typeof blockTime === "number" || typeof blockTime === "bigint") {
    return blockTime;
  }
  return null;
}

function getBlockTimeMs(blockTime: number | bigint | null): number | null {
  if (blockTime === null) {
    return null;
  }
  const blockTimeSeconds = Number(blockTime);
  if (!Number.isFinite(blockTimeSeconds)) {
    return null;
  }
  return blockTimeSeconds * 1000;
}

function assertPushTransactionFresh(
  challenge: mppChallengeParams,
  blockTime: number | bigint | null,
) {
  const blockTimeMs = getBlockTimeMs(blockTime);
  if (blockTimeMs === null) {
    throw new Error("confirmed transaction is missing block time");
  }

  const now = Date.now();
  if (blockTimeMs > now + SIGNATURE_BLOCK_TIME_CLOCK_SKEW_MS) {
    throw new Error("confirmed transaction block time is in the future");
  }

  if (challenge.expires === undefined) {
    if (now - blockTimeMs > SIGNATURE_REPLAY_TTL_MS) {
      throw new Error("confirmed transaction is too old");
    }
    return;
  }

  const expiresAtMs = parseMPPExpiresAtMs(challenge.expires);
  if (expiresAtMs === null) {
    throw new Error("invalid challenge expiration");
  }

  const earliestBlockTimeMs =
    expiresAtMs -
    CHARGE_CHALLENGE_TIMEOUT_MS -
    SIGNATURE_BLOCK_TIME_CLOCK_SKEW_MS;
  const latestBlockTimeMs = expiresAtMs + SIGNATURE_BLOCK_TIME_CLOCK_SKEW_MS;
  if (blockTimeMs < earliestBlockTimeMs || blockTimeMs > latestBlockTimeMs) {
    throw new Error(
      "confirmed transaction block time is outside challenge window",
    );
  }
}

type ConfirmedChargeVerifier = (
  transactionMessage: CompilableTransactionMessage,
) => Promise<{ payer: string } | { error: string }>;

const verifyConfirmedTransaction = async (args: {
  rpc: Rpc<SolanaRpcApi>;
  signature: string;
  maxRetries: number;
  retryDelayMs: number;
  verifyTransaction: ConfirmedChargeVerifier;
}) => {
  const confirmedTransaction = await fetchConfirmedTransaction(
    args.rpc,
    args.signature,
    args.maxRetries,
    args.retryDelayMs,
  );

  if (!confirmedTransaction) {
    throw new Error("could not fetch confirmed transaction");
  }

  const verifyResult = await args.verifyTransaction(
    confirmedTransaction.transactionMessage,
  );
  if ("error" in verifyResult) {
    throw new Error(
      `confirmed transaction verification failed: ${verifyResult.error}`,
    );
  }
};

const decodeWireTransaction = (base64Transaction: string) => {
  const txBytes = getBase64Encoder().encode(base64Transaction);
  const decodedTx = getTransactionDecoder().decode(txBytes);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    decodedTx.messageBytes,
  );
  assertNoAddressLookupTables(compiledMessage);
  return {
    transactionMessage: decompileTransactionMessage(compiledMessage),
    decodedTx,
  };
};

function assertNoAddressLookupTables(compiledMessage: unknown) {
  const addressTableLookups = (
    compiledMessage as { readonly addressTableLookups?: readonly unknown[] }
  ).addressTableLookups;
  if ((addressTableLookups?.length ?? 0) > 0) {
    throw new Error("address lookup tables are not supported");
  }
}

async function claimConsumedSignature(
  replayStore: ReplayStore,
  signature: string,
) {
  const key = `${SIGNATURE_REPLAY_PREFIX}${signature}`;
  const claimed = await replayStore.claim(
    key,
    Date.now() + SIGNATURE_REPLAY_TTL_MS,
  );
  if (!claimed) {
    throw new Error("transaction signature already consumed");
  }
  return () => replayStore.release(key);
}

async function releaseSignatureClaim(release: () => Promise<void>) {
  try {
    await release();
  } catch (error) {
    logger.error("failed to release consumed signature claim", {
      error: getErrorMessage(error),
    });
  }
}

function getReceiptTimestamp(now = new Date()): string {
  return formatMPPDateTime(now);
}

function createChargeReceipt(
  challenge: mppChallengeParams,
  reference: string,
): mppReceipt {
  return {
    status: "success",
    method: "solana",
    challengeId: challenge.id,
    timestamp: getReceiptTimestamp(),
    reference,
  };
}

function assertChallengeNotExpired(challenge: mppChallengeParams) {
  if (challenge.expires === undefined) return;

  const expiresAtMs = parseMPPExpiresAtMs(challenge.expires);
  if (expiresAtMs === null) {
    throw new Error("invalid challenge expiry");
  }
  if (Date.now() > expiresAtMs) {
    throw new Error("challenge expired");
  }
}

function chargeRequestMatchesPricing(args: {
  currency: string;
  pricing: ResourcePricing;
  request: mppChargeRequest;
  solanaNetwork: SolanaCAIP2Network;
}): boolean {
  const { currency, pricing, request, solanaNetwork } = args;
  return (
    lookupX402Network(pricing.network).caip2 === solanaNetwork.caip2 &&
    request.amount === pricing.amount &&
    request.currency === currency &&
    pricing.asset === currency &&
    request.recipient === pricing.recipient
  );
}

export async function createMPPSolanaChargeHandler(
  args: CreateMPPSolanaChargeHandlerArgs,
): Promise<MPPMethodHandler> {
  const {
    network,
    replayStore,
    realm,
    secretKey,
    maxRetries = 30,
    retryDelayMs = 1000,
    maxPriorityFee = 100_000,
  } = args;
  const rpc = toRpc(args.rpc);
  const mint: Address = toAddress(args.mint);
  const feePayerSigner: KeyPairSigner | undefined = args.feePayerSigner
    ? await toKeyPairSigner(args.feePayerSigner)
    : undefined;

  const solanaNetwork = lookupX402Network(network);
  const mintAddress = mint;
  const hasFeePayer = feePayerSigner !== undefined;
  const feePayerAddress = feePayerSigner?.address;

  const mintInfo = await fetchMint(rpc, mint);
  const tokenProgram = mintInfo.programAddress;

  const getChallenge = async (
    intent: string,
    pricing: ResourcePricing,
    _resourceURL: string,
    opts?: ChallengeOpts,
  ): Promise<mppChallengeParams> => {
    const methodDetails: mppChargeRequest["methodDetails"] = {
      // Keep Solana's "mainnet-beta" cluster spelling for
      // interoperability with other implementations.
      network: caip2ToCluster(solanaNetwork.caip2) ?? solanaNetwork.caip2,
      decimals: mintInfo.data.decimals,
      tokenProgram,
    };

    if (hasFeePayer && feePayerAddress) {
      const latestBlockhash = await rpc.getLatestBlockhash().send();
      methodDetails.feePayer = true;
      methodDetails.feePayerKey = feePayerAddress;
      methodDetails.recentBlockhash = latestBlockhash.value.blockhash;
    }

    const requestBody: mppChargeRequest = {
      amount: pricing.amount,
      currency: mintAddress,
      recipient: pricing.recipient,
      externalId: crypto.randomUUID(),
      ...(pricing.description ? { description: pricing.description } : {}),
      methodDetails,
    };

    const requestEncoded = encodeBase64URL(canonicalizeSortedJSON(requestBody));

    const expiresAt = Date.now() + CHARGE_CHALLENGE_TIMEOUT_MS;

    const paramsWithoutID: Omit<mppChallengeParams, "id"> = {
      realm,
      method: "solana",
      intent,
      request: requestEncoded,
      expires: formatMPPDateTime(new Date(expiresAt)),
      ...(opts?.digest !== undefined ? { digest: opts.digest } : {}),
    };

    const id = await generateChallengeID(secretKey, paramsWithoutID);
    await replayStore.add(id, expiresAt);

    return { id, ...paramsWithoutID };
  };

  const handleSettle = async (
    credential: mppCredential,
    context: MPPHandlerContext,
  ): Promise<mppReceipt | null> => {
    const { challenge, payload } = credential;

    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    const idValid = await verifyChallengeID(secretKey, challenge);
    if (!idValid) {
      throw new Error("invalid challenge ID");
    }

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency === "sol") return null;

    assertChallengeNotExpired(challenge);

    if (
      !chargeRequestMatchesPricing({
        currency: mintAddress,
        pricing: context.pricing,
        request,
        solanaNetwork,
      })
    ) {
      return null;
    }

    const validatedPayload = chargeCredentialPayload(payload);
    if (isValidationError(validatedPayload)) {
      throw new Error(
        `invalid credential payload: ${validatedPayload.summary}`,
      );
    }

    const consumed = await replayStore.consume(challenge.id);
    if (!consumed) {
      throw new Error("challenge ID already consumed or expired");
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

      const confirmedTransaction = await fetchConfirmedTransaction(
        rpc,
        validatedPayload.signature,
        maxRetries,
        retryDelayMs,
      );

      if (!confirmedTransaction) {
        throw new Error("could not fetch confirmed transaction");
      }
      assertPushTransactionFresh(challenge, confirmedTransaction.blockTime);

      const verifyResult = await verifyChargeTransaction({
        transactionMessage: confirmedTransaction.transactionMessage,
        ...verifyArgs,
      });

      if ("error" in verifyResult) {
        throw new Error(
          `transaction verification failed: ${verifyResult.error}`,
        );
      }

      await claimConsumedSignature(replayStore, validatedPayload.signature);

      return createChargeReceipt(challenge, validatedPayload.signature);
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

    let transactionToSend = decodedTx;
    if (request.methodDetails?.feePayer === true) {
      if (!feePayerSigner) {
        throw new Error("pull mode requires a fee payer keypair");
      }
      transactionToSend = await partiallySignTransaction(
        [feePayerSigner.keyPair],
        decodedTx,
      );
    }

    // Reserve the signature before broadcasting so a replayed payment is
    // rejected here rather than after it has already settled on-chain.
    const releaseConsumedSignature = await claimConsumedSignature(
      replayStore,
      getSignatureFromTransaction(transactionToSend),
    );

    const txResult = await sendTransaction(
      rpc,
      transactionToSend,
      maxRetries,
      retryDelayMs,
    );

    if (!txResult.success) {
      if (!txResult.submitted) {
        await releaseSignatureClaim(releaseConsumedSignature);
      }
      throw new Error(`settlement failed: ${txResult.error}`);
    }

    await verifyConfirmedTransaction({
      rpc,
      signature: txResult.signature,
      maxRetries,
      retryDelayMs,
      verifyTransaction: (confirmedTransactionMessage) =>
        verifyChargeTransaction({
          transactionMessage: confirmedTransactionMessage,
          ...verifyArgs,
        }),
    });

    return createChargeReceipt(challenge, txResult.signature);
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

export type CreateMPPSolanaNativeChargeHandlerArgs = {
  network: string | SolanaCAIP2Network;
  rpc: Rpc<SolanaRpcApi> | string;
  feePayerSigner?:
    | KeyPairSigner
    | { secretKey: Uint8Array; publicKey: { toBase58(): string } };
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
    replayStore,
    realm,
    secretKey,
    maxRetries = 30,
    retryDelayMs = 1000,
    maxPriorityFee = 100_000,
  } = args;
  const rpc = toRpc(args.rpc);
  const feePayerSigner: KeyPairSigner | undefined = args.feePayerSigner
    ? await toKeyPairSigner(args.feePayerSigner)
    : undefined;

  const solanaNetwork = lookupX402Network(network);
  const hasFeePayer = feePayerSigner !== undefined;
  const feePayerAddress = feePayerSigner?.address;

  const getChallenge = async (
    intent: string,
    pricing: ResourcePricing,
    _resourceURL: string,
    opts?: ChallengeOpts,
  ): Promise<mppChallengeParams> => {
    const methodDetails: mppChargeRequest["methodDetails"] = {
      // Keep Solana's "mainnet-beta" cluster spelling for
      // interoperability with other implementations.
      network: caip2ToCluster(solanaNetwork.caip2) ?? solanaNetwork.caip2,
    };

    if (hasFeePayer && feePayerAddress) {
      const latestBlockhash = await rpc.getLatestBlockhash().send();
      methodDetails.feePayer = true;
      methodDetails.feePayerKey = feePayerAddress;
      methodDetails.recentBlockhash = latestBlockhash.value.blockhash;
    }

    const requestBody: mppChargeRequest = {
      amount: pricing.amount,
      currency: "sol",
      recipient: pricing.recipient,
      externalId: crypto.randomUUID(),
      ...(pricing.description ? { description: pricing.description } : {}),
      methodDetails,
    };

    const requestEncoded = encodeBase64URL(canonicalizeSortedJSON(requestBody));

    const expiresAt = Date.now() + CHARGE_CHALLENGE_TIMEOUT_MS;

    const paramsWithoutID: Omit<mppChallengeParams, "id"> = {
      realm,
      method: "solana",
      intent,
      request: requestEncoded,
      expires: formatMPPDateTime(new Date(expiresAt)),
      ...(opts?.digest !== undefined ? { digest: opts.digest } : {}),
    };

    const id = await generateChallengeID(secretKey, paramsWithoutID);
    await replayStore.add(id, expiresAt);

    return { id, ...paramsWithoutID };
  };

  const handleSettle = async (
    credential: mppCredential,
    context: MPPHandlerContext,
  ): Promise<mppReceipt | null> => {
    const { challenge, payload } = credential;

    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    const idValid = await verifyChallengeID(secretKey, challenge);
    if (!idValid) {
      throw new Error("invalid challenge ID");
    }

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency !== "sol") return null;

    assertChallengeNotExpired(challenge);

    if (
      !chargeRequestMatchesPricing({
        currency: "sol",
        pricing: context.pricing,
        request,
        solanaNetwork,
      })
    ) {
      return null;
    }

    const validatedPayload = chargeCredentialPayload(payload);
    if (isValidationError(validatedPayload)) {
      throw new Error(
        `invalid credential payload: ${validatedPayload.summary}`,
      );
    }

    const consumed = await replayStore.consume(challenge.id);
    if (!consumed) {
      throw new Error("challenge ID already consumed or expired");
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

      const confirmedTransaction = await fetchConfirmedTransaction(
        rpc,
        validatedPayload.signature,
        maxRetries,
        retryDelayMs,
      );

      if (!confirmedTransaction) {
        throw new Error("could not fetch confirmed transaction");
      }
      assertPushTransactionFresh(challenge, confirmedTransaction.blockTime);

      const verifyResult = await verifyNativeChargeTransaction({
        transactionMessage: confirmedTransaction.transactionMessage,
        ...verifyArgs,
      });

      if ("error" in verifyResult) {
        throw new Error(
          `transaction verification failed: ${verifyResult.error}`,
        );
      }

      await claimConsumedSignature(replayStore, validatedPayload.signature);

      return createChargeReceipt(challenge, validatedPayload.signature);
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

    let transactionToSend = decodedTx;
    if (request.methodDetails?.feePayer === true) {
      if (!feePayerSigner) {
        throw new Error("pull mode requires a fee payer keypair");
      }
      transactionToSend = await partiallySignTransaction(
        [feePayerSigner.keyPair],
        decodedTx,
      );
    }

    // Reserve the signature before broadcasting so a replayed payment is
    // rejected here rather than after it has already settled on-chain.
    const releaseConsumedSignature = await claimConsumedSignature(
      replayStore,
      getSignatureFromTransaction(transactionToSend),
    );

    const txResult = await sendTransaction(
      rpc,
      transactionToSend,
      maxRetries,
      retryDelayMs,
    );

    if (!txResult.success) {
      if (!txResult.submitted) {
        await releaseSignatureClaim(releaseConsumedSignature);
      }
      throw new Error(`settlement failed: ${txResult.error}`);
    }

    await verifyConfirmedTransaction({
      rpc,
      signature: txResult.signature,
      maxRetries,
      retryDelayMs,
      verifyTransaction: (confirmedTransactionMessage) =>
        verifyNativeChargeTransaction({
          transactionMessage: confirmedTransactionMessage,
          ...verifyArgs,
        }),
    });

    return createChargeReceipt(challenge, txResult.signature);
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
