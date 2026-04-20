import {
  type x402PaymentRequirements,
  type x402PaymentPayload,
  type x402SettleResponse,
  type x402VerifyResponse,
  type x402SupportedKind,
} from "@faremeter/types/x402v2";
import { isValidationError } from "@faremeter/types";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import {
  clusterToCAIP2,
  isKnownCluster,
  caip2ToCluster,
  isSolanaCAIP2Network,
  type KnownCluster,
  type SolanaCAIP2Network,
} from "@faremeter/info/solana";
import {
  fetchMint,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCloseAccountInstruction,
} from "@solana-program/token";
import {
  address,
  createKeyPairSignerFromBytes,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  pipe,
  type Address,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";
import type { TransactionError } from "@solana/rpc-types";
import { type } from "arktype";
import { isValidTransaction } from "./verify";
import { toAddress, toKeyPairSigner, toRpc } from "../compat";
import { logger } from "./logger";
import { x402Scheme, generateMatcher } from "./common";
import { getAddMemoInstruction } from "@solana-program/memo";
import { TransactionStore } from "./cache";

export interface HookBaseArgs {
  network: string | SolanaCAIP2Network;
  rpc: Rpc<SolanaRpcApi>;
  feePayerSigner: KeyPairSigner;
  mint: Address;
  mintInfo: Awaited<ReturnType<typeof fetchMint>>;
  requirements: x402PaymentRequirements;
  payment: x402PaymentPayload;
  logger: typeof logger;
}

export type HookResponseArgs<Response> = HookBaseArgs & { response: Response };

export type HookResponseFuncs<Response> = (
  args: HookResponseArgs<Response>,
) => Promise<Response> | Promise<void>;

export interface FacilitatorHooks {
  afterVerify?: HookResponseFuncs<x402VerifyResponse>;
  afterSettle?: HookResponseFuncs<x402SettleResponse>;
}

export const PaymentRequirementsExtraFeatures = type({
  xSettlementAccountSupported: "boolean?",
});

export type PaymentRequirementsExtraFeatures =
  typeof PaymentRequirementsExtraFeatures.infer;

export const PaymentRequirementsExtra = type({
  feePayer: "string",
  decimals: "number?",
  recentBlockhash: "string?",
  "memo?": "string",
  "tokenProgram?": "string",
  features: PaymentRequirementsExtraFeatures.optional(),
});

interface FacilitatorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  // Maximum priority fee in lamports
  // Calculated as: (CU limit * CU price in microlamports) / 1,000,000
  maxPriorityFee?: number;
  maxTransactionAge?: number;
  // When false, accept transactions without a Memo instruction so that
  // older clients that do not include one can still pay.  Defaults to
  // true for spec compliance.
  requireMemo?: boolean;
  features?: {
    enableSettlementAccounts?: boolean;
    enableDuplicateCheck?: boolean;
  };
  hooks?: readonly FacilitatorHooks[];
}

const TransactionString = type("string").pipe.try((tx) => {
  const decoder = getTransactionDecoder();
  const base64Encoder = getBase64Encoder();
  const transactionBytes = base64Encoder.encode(tx);
  return decoder.decode(transactionBytes);
});

export const PaymentPayloadTransaction = type({
  transaction: TransactionString,
});
export type PaymentPayloadTransaction = typeof PaymentPayloadTransaction.infer;

export const PaymentPayloadSettlementAccount = type({
  transactionSignature: "string",
  settleSecretKey: type("string.base64").pipe.try((s) =>
    Uint8Array.from(Buffer.from(s, "base64")),
  ),
  "settlementRentDestination?": "string",
});
export type PaymentPayloadSettlementAccount =
  typeof PaymentPayloadSettlementAccount.infer;

export function transactionErrorToString(t: TransactionError) {
  if (typeof t == "string") {
    return t;
  }

  if (typeof t == "object") {
    return JSON.stringify(t, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  }

  return String(t);
}

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
        error: `Transaction failed: ${transactionErrorToString(status.value[0].err)}`,
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

/**
 * Creates a facilitator handler for the Solana exact payment scheme.
 *
 * The handler validates incoming payment transactions, signs them with the
 * fee payer keypair, and submits them to the Solana network.
 *
 * @param network - Solana network identifier (cluster name, CAIP-2 string, or SolanaCAIP2Network object)
 * @param rpcInput - Solana RPC client
 * @param feePayerSignerInput - Keypair or signer for paying transaction fees
 * @param mintInput - SPL token mint public key
 * @param config - Optional configuration for retries, fees, and hooks
 * @returns A FacilitatorHandler for processing Solana exact payments
 */
export const createFacilitatorHandler = async (
  network: string | SolanaCAIP2Network,
  rpcInput: Rpc<SolanaRpcApi> | string,
  feePayerSignerInput:
    | KeyPairSigner
    | { secretKey: Uint8Array; publicKey: { toBase58(): string } },
  mintInput: Address | { toBase58(): string },
  config?: FacilitatorOptions,
): Promise<FacilitatorHandler> => {
  const rpc = toRpc(rpcInput);
  const mint: Address = toAddress(mintInput);
  const feePayerSigner: KeyPairSigner =
    await toKeyPairSigner(feePayerSignerInput);
  const { isMatchingRequirement } = generateMatcher(network, mint);

  const {
    maxRetries = 30,
    retryDelayMs = 1000,
    maxPriorityFee = 100_000,
    maxTransactionAge = 150,
  } = config ?? {};

  const mintInfo = await fetchMint(rpc, mint);

  const tokenProgram = mintInfo.programAddress;

  const hookArgs = {
    network,
    rpc,
    feePayerSigner,
    mint,
    mintInfo,
    logger,
  };

  const features: PaymentRequirementsExtraFeatures = {};

  if (config?.features?.enableSettlementAccounts) {
    features.xSettlementAccountSupported = true;
  }

  const seenTxs = new TransactionStore(maxTransactionAge);

  const processSettlementAccount = async (
    requirements: x402PaymentRequirements,
    paymentPayload: PaymentPayloadSettlementAccount,
  ) => {
    const errorResponse = (error: string) => ({ error });

    // XXX - It would be nicer to do this check in the arktype
    // validation.  Unfortunately getting match to generate things
    // properly turned out to create excessive TypeScript types
    // that caused tsc to error out.
    if (!config?.features?.enableSettlementAccounts) {
      return errorResponse("settlement accounts are not accepted");
    }

    const settleSigner = await createKeyPairSignerFromBytes(
      paymentPayload.settleSecretKey,
    );

    const settleOwner = settleSigner.address;

    const [settleATA] = await findAssociatedTokenPda({
      mint,
      owner: settleOwner,
      tokenProgram,
    });

    const { value: accountBalance } = await rpc
      .getTokenAccountBalance(settleATA, { commitment: "confirmed" })
      .send();

    logger.debug("settlement account info", {
      settleOwner,
      settleATA,
      accountBalance,
    });

    if (BigInt(accountBalance.amount) !== BigInt(requirements.amount)) {
      return errorResponse(
        "settlement account balance didn't match payment requirements",
      );
    }

    const settle = async () => {
      const [payToATA] = await findAssociatedTokenPda({
        mint,
        owner: address(requirements.payTo),
        tokenProgram,
      });

      const closeDestination = paymentPayload.settlementRentDestination
        ? address(paymentPayload.settlementRentDestination)
        : feePayerSigner.address;

      const programAddress = tokenProgram;
      const instructions = [
        getAddMemoInstruction({ memo: crypto.randomUUID() }),
        getTransferCheckedInstruction(
          {
            source: settleATA,
            mint,
            destination: payToATA,
            authority: settleSigner,
            amount: BigInt(requirements.amount),
            decimals: mintInfo.data.decimals,
          },
          { programAddress },
        ),
        getCloseAccountInstruction(
          {
            account: settleATA,
            destination: closeDestination,
            owner: settleSigner,
          },
          { programAddress },
        ),
      ];
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      // Build the transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayerSigner(feePayerSigner, msg),
        (msg) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => appendTransactionMessageInstructions(instructions, msg),
      );

      const signedTransaction =
        await signTransactionMessageWithSigners(transactionMessage);

      return {
        signedTransaction,
      };
    };

    return {
      payer: settleOwner,
      settle,
    };
  };

  const processTransaction = async (
    requirements: x402PaymentRequirements,
    paymentPayload: PaymentPayloadTransaction,
  ) => {
    const errorResponse = (error: string) => ({ error });

    let transactionMessage, transaction, blockHeight;
    try {
      transaction = paymentPayload.transaction;
      const compiledTransactionMessage =
        getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      transactionMessage = decompileTransactionMessage(
        compiledTransactionMessage,
      );

      const lifetimeConstraint = transactionMessage.lifetimeConstraint;

      if ("blockhash" in lifetimeConstraint) {
        blockHeight = Number(lifetimeConstraint.lastValidBlockHeight) - 150;
      } else {
        return errorResponse("Transaction cannot include a nonce account");
      }
    } catch (cause) {
      throw new Error("Failed to get compiled transaction message", { cause });
    }

    let validResult;
    try {
      validResult = await isValidTransaction(
        transactionMessage,
        requirements,
        feePayerSigner.address,
        tokenProgram,
        { maxPriorityFee, requireMemo: config?.requireMemo ?? true },
      );
      if (!validResult) {
        logger.error("Invalid transaction");
        return errorResponse("Invalid transaction");
      }
    } catch (cause) {
      throw new Error("Failed to validate transaction", { cause });
    }

    const { payer } = validResult;

    return {
      payer,
      blockHeight,
      settle: async () => {
        let signedTransaction;
        try {
          signedTransaction = await partiallySignTransaction(
            [feePayerSigner.keyPair],
            transaction,
          );
        } catch (cause) {
          throw new Error("Failed to partially sign transaction", { cause });
        }

        return { signedTransaction };
      },
    };
  };

  const determinePaymentPayload = function (
    requirements: x402PaymentRequirements,
    possiblePayload: object,
  ) {
    // XXX - It would be great to do this automatically using arktype,
    // but because of the overlapping input types and the morphs, this
    // ends up being more annoying than you'd think.  So instead, use
    // hints to do the correct validation.
    if (
      config?.features?.enableSettlementAccounts &&
      "settleSecretKey" in possiblePayload
    ) {
      const paymentPayload = PaymentPayloadSettlementAccount(possiblePayload);

      if (isValidationError(paymentPayload)) {
        return paymentPayload;
      }

      return processSettlementAccount(requirements, paymentPayload);
    } else {
      const paymentPayload = PaymentPayloadTransaction(possiblePayload);

      if (isValidationError(paymentPayload)) {
        return paymentPayload;
      }

      return processTransaction(requirements, paymentPayload);
    }
  };

  const resolveCluster = (): KnownCluster => {
    if (isSolanaCAIP2Network(network)) {
      const resolved = caip2ToCluster(network.caip2);
      if (resolved) {
        return resolved;
      }
      throw new Error(`Unknown Solana network: ${network.caip2}`);
    }
    if (isKnownCluster(network)) {
      return network;
    }
    const resolved = caip2ToCluster(network);
    if (resolved) {
      return resolved;
    }
    throw new Error(`Unknown Solana network: ${network}`);
  };

  const getSupported = (): Promise<x402SupportedKind>[] => {
    return [
      Promise.resolve({
        x402Version: 2,
        scheme: x402Scheme,
        network: clusterToCAIP2(resolveCluster()).caip2,
        extra: {
          feePayer: feePayerSigner.address,
          tokenProgram,
          features,
        },
      }),
    ];
  };

  const getRequirements = async ({
    accepts: req,
  }: {
    accepts: x402PaymentRequirements[];
  }) => {
    const recentBlockhash = (await rpc.getLatestBlockhash().send()).value
      .blockhash;
    return req.filter(isMatchingRequirement).map((x) => {
      const incomingExtra = PaymentRequirementsExtra(x.extra);
      const memo =
        !isValidationError(incomingExtra) && incomingExtra.memo !== undefined
          ? { memo: incomingExtra.memo }
          : {};

      return {
        ...x,
        asset: mint,
        extra: {
          feePayer: feePayerSigner.address,
          decimals: mintInfo.data.decimals,
          recentBlockhash,
          ...memo,
          tokenProgram,
          features,
        },
      };
    });
  };

  const handleVerify = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => {
    if (!isMatchingRequirement(requirements)) {
      return null;
    }

    const errorResponse = (invalidReason: string) => ({
      isValid: false,
      invalidReason,
    });

    const processor = determinePaymentPayload(requirements, payment.payload);

    if (isValidationError(processor)) {
      return errorResponse(processor.summary);
    }

    const verifyResult = await processor;

    if ("error" in verifyResult) {
      return errorResponse(verifyResult.error);
    }

    let response: x402VerifyResponse = {
      isValid: true,
      payer: verifyResult.payer,
    };

    const hooks = config?.hooks;

    if (hooks !== undefined) {
      const args = {
        ...hookArgs,
        requirements,
        payment,
        response,
      };

      for (const hook of hooks) {
        if (hook.afterVerify === undefined) {
          continue;
        }

        const res = await hook.afterVerify({
          ...args,
          response,
        });

        if (res !== undefined) {
          response = res;
        }
      }
    }

    return response;
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => {
    if (!isMatchingRequirement(requirements)) {
      return null;
    }

    const errorResponse = (msg: string): x402SettleResponse => {
      logger.error(msg);
      return {
        success: false,
        errorReason: msg,
        transaction: "",
        network: requirements.network,
      };
    };

    const processor = determinePaymentPayload(requirements, payment.payload);

    if (isValidationError(processor)) {
      return errorResponse(processor.summary);
    }

    const verifyResult = await processor;

    if ("error" in verifyResult) {
      return errorResponse(verifyResult.error);
    }

    const { payer } = verifyResult;

    const { signedTransaction } = await verifyResult.settle();

    if (
      config?.features?.enableDuplicateCheck &&
      "blockHeight" in verifyResult
    ) {
      const signature = getSignatureFromTransaction(signedTransaction);
      const { blockHeight } = verifyResult;
      if (seenTxs.has(signature)) {
        logger.warning("Duplicate transaction rejected", { signature });
        return errorResponse("Duplicate transaction");
      }
      seenTxs.add(signature, blockHeight);
    }

    let result;
    try {
      result = await sendTransaction(
        rpc,
        signedTransaction,
        maxRetries,
        retryDelayMs,
      );
    } catch (cause) {
      throw new Error("Failed to send transaction", { cause });
    }

    if (!result.success) {
      return errorResponse(result.error);
    }

    let response: x402SettleResponse = {
      success: true,
      transaction: result.signature,
      network: payment.accepted.network,
      payer,
    };

    const hooks = config?.hooks;
    if (hooks !== undefined) {
      const args = {
        ...hookArgs,
        requirements,
        payment,
        response,
      };

      for (const hook of hooks) {
        if (hook.afterSettle === undefined) {
          continue;
        }

        const res = await hook.afterSettle({
          ...args,
          response,
        });

        if (res !== undefined) {
          response = res;
        }
      }
    }

    return response;
  };

  return {
    getSupported,
    getRequirements,
    handleVerify,
    handleSettle,
  };
};
