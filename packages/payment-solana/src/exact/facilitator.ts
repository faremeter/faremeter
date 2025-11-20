import {
  x402PaymentRequirements,
  type x402PaymentPayload,
  type x402SettleResponse,
  type x402SupportedKind,
} from "@faremeter/types/x402";
import { isValidationError } from "@faremeter/types";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import { lookupX402Network } from "@faremeter/info/solana";
import { fetchMint } from "@solana-program/token";
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
  type Rpc,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";
import type { TransactionError } from "@solana/rpc-types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { type } from "arktype";
import { isValidTransaction } from "./verify";
import { logger } from "./logger";
import { x402Scheme, generateMatcher } from "./common";

import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCloseAccountInstruction,
} from "@solana-program/token";

import { getAddMemoInstruction } from "@solana-program/memo";

export const PaymentRequirementsExtraFeatures = type({
  xSettlementAccountSupported: "boolean?",
});

export type PaymentRequirementsExtraFeatures =
  typeof PaymentRequirementsExtraFeatures.infer;

export const PaymentRequirementsExtra = type({
  feePayer: "string",
  decimals: "number?",
  recentBlockhash: "string?",
  features: PaymentRequirementsExtraFeatures.optional(),
});

interface FacilitatorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  // Maximum priority fee in lamports
  // Calculated as: (CU limit * CU price in microlamports) / 1,000,000
  maxPriorityFee?: number;
  features?: {
    enableSettlementAccounts?: boolean;
  };
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
    logger.error("transaction simulation failed: {*}", simResult.value);
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

export const createFacilitatorHandler = async (
  network: string,
  rpc: Rpc<SolanaRpcApi>,
  feePayerKeypair: Keypair,
  mint: PublicKey,
  config?: FacilitatorOptions,
): Promise<FacilitatorHandler> => {
  const { isMatchingRequirement } = generateMatcher(network, mint.toBase58());

  const {
    maxRetries = 30,
    retryDelayMs = 1000,
    maxPriorityFee = 100_000,
  } = config ?? {};

  const mintInfo = await fetchMint(rpc, address(mint.toBase58()));

  const features: PaymentRequirementsExtraFeatures = {};

  if (config?.features?.enableSettlementAccounts) {
    features.xSettlementAccountSupported = true;
  }

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
      mint: address(mint.toBase58()),
      owner: settleOwner,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const { value: accountBalance } = await rpc
      .getTokenAccountBalance(settleATA, { commitment: "confirmed" })
      .send();

    logger.debug("settlement account info: {*}", {
      settleOwner,
      settleATA,
      accountBalance,
    });

    if (
      BigInt(accountBalance.amount) !== BigInt(requirements.maxAmountRequired)
    ) {
      return errorResponse(
        "settlement account balance didn't match payment requirements",
      );
    }

    const settle = async () => {
      const feePayerSigner = await createKeyPairSignerFromBytes(
        feePayerKeypair.secretKey,
      );

      const [payToATA] = await findAssociatedTokenPda({
        mint: address(mint.toBase58()),
        owner: address(requirements.payTo),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      const instructions = [
        getAddMemoInstruction({ memo: crypto.randomUUID() }),
        getTransferCheckedInstruction({
          source: settleATA,
          mint: address(mint.toBase58()),
          destination: payToATA,
          authority: settleSigner,
          amount: BigInt(requirements.maxAmountRequired),
          decimals: mintInfo.data.decimals,
        }),
        getCloseAccountInstruction({
          account: settleATA,
          destination: feePayerSigner.address,
          owner: settleSigner,
        }),
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
      settle,
    };
  };

  const processTransaction = async (
    requirements: x402PaymentRequirements,
    paymentPayload: PaymentPayloadTransaction,
  ) => {
    const errorResponse = (error: string) => ({ error });

    let transactionMessage, transaction;
    try {
      transaction = paymentPayload.transaction;
      const compiledTransactionMessage =
        getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      transactionMessage = decompileTransactionMessage(
        compiledTransactionMessage,
      );
    } catch (cause) {
      throw new Error("Failed to get compiled transaction message", { cause });
    }

    try {
      if (
        !(await isValidTransaction(
          transactionMessage,
          requirements,
          feePayerKeypair.publicKey,
          maxPriorityFee,
        ))
      ) {
        logger.error("Invalid transaction");
        return errorResponse("Invalid transaction");
      }
    } catch (cause) {
      throw new Error("Failed to validate transaction", { cause });
    }

    return {
      settle: async () => {
        let signedTransaction;
        try {
          const kitKeypair = await createKeyPairSignerFromBytes(
            feePayerKeypair.secretKey,
          );
          signedTransaction = await partiallySignTransaction(
            [kitKeypair.keyPair],
            transaction,
          );
        } catch (cause) {
          throw new Error("Failed to partially sign transaction", { cause });
        }

        return {
          signedTransaction,
        };
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

  const getSupported = (): Promise<x402SupportedKind>[] => {
    return lookupX402Network(network).map((network) =>
      Promise.resolve({
        x402Version: 1,
        scheme: x402Scheme,
        network,
        extra: {
          feePayer: feePayerKeypair.publicKey.toString(),
          features,
        },
      }),
    );
  };

  const getRequirements = async (req: x402PaymentRequirements[]) => {
    const recentBlockhash = (await rpc.getLatestBlockhash().send()).value
      .blockhash;
    return req.filter(isMatchingRequirement).map((x) => {
      return {
        ...x,
        asset: mint.toBase58(),
        extra: {
          feePayer: feePayerKeypair.publicKey.toString(),
          decimals: mintInfo.data.decimals,
          recentBlockhash,
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

    return { isValid: true };
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
        error: msg,
        txHash: null,
        networkId: null,
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

    const { signedTransaction } = await verifyResult.settle();

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

    return {
      success: true,
      error: null,
      txHash: result.signature,
      networkId: payment.network,
    };
  };

  return {
    getSupported,
    getRequirements,
    handleVerify,
    handleSettle,
  };
};
