import type {
  x402PaymentPayload,
  x402PaymentRequirements,
  x402SettleResponse,
  x402SupportedKind,
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
  type Rpc,
  type SolanaRpcApi,
  type Transaction,
  pipe,
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
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCloseAccountInstruction,
} from "@solana-program/token";

export const PaymentRequirementsExtra = type({
  feePayer: "string",
  decimals: "number?",
  recentBlockhash: "string?",
});

export type PaymentRequirementsExtra = typeof PaymentRequirementsExtra.infer;

interface FacilitatorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  // Maximum priority fee in lamports
  // Calculated as: (CU limit * CU price in microlamports) / 1,000,000
  maxPriorityFee?: number;
}

function errorResponse(msg: string): x402SettleResponse {
  logger.error(msg);
  return {
    success: false,
    error: msg,
    txHash: null,
    networkId: null,
  };
}

const TransactionString = type("string").pipe.try((tx) => {
  const decoder = getTransactionDecoder();
  const base64Encoder = getBase64Encoder();
  const transactionBytes = base64Encoder.encode(tx);
  return decoder.decode(transactionBytes);
});

export const PaymentPayload = type({
  transactionSignature: "string",
  settleSecretKey: type("string.base64").pipe.try((s) =>
    Uint8Array.from(Buffer.from(s, "base64")),
  ),
});

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

  const getSupported = (): Promise<x402SupportedKind>[] => {
    return lookupX402Network(network).map((network) =>
      Promise.resolve({
        x402Version: 1,
        scheme: x402Scheme,
        network,
        extra: {
          feePayer: feePayerKeypair.publicKey.toString(),
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
        },
      };
    });
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => {
    if (!isMatchingRequirement(requirements)) {
      return null;
    }

    const paymentPayload = PaymentPayload(payment.payload);
    if (isValidationError(paymentPayload)) {
      return errorResponse(paymentPayload.summary);
    }

    console.log("@@@@ REQUIREMENTS", requirements);
    console.log("1!!! PAYMENT", payment);
    console.log("1!!! PAYMENT PAYLOAD", paymentPayload);

    const feePayerSigner = await createKeyPairSignerFromBytes(
      feePayerKeypair.secretKey,
    );
    const settleSigner = await createKeyPairSignerFromBytes(
      paymentPayload.settleSecretKey,
    );

    const [settleATA] = await findAssociatedTokenPda({
      mint: address(mint.toBase58()),
      owner: settleSigner.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [payToATA] = await findAssociatedTokenPda({
      mint: address(mint.toBase58()),
      owner: address(requirements.payTo),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const instructions = [
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
    handleSettle,
  };
};
