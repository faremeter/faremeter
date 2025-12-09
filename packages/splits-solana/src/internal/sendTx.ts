import type {
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
  Instruction,
} from "@solana/kit";
import {
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  pipe,
} from "@solana/kit";
import { getBase64EncodedWireTransaction } from "@solana/transactions";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { logger } from "../logger.js";

export interface SendTxOptions {
  /** Compute unit limit (default: 200_000) */
  computeUnitLimit?: number;
  /** Priority fee in microlamports */
  computeUnitPrice?: bigint;
  /** Max retries for confirmation polling (default: 30) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelayMs?: number;
}

export interface SendTxResult {
  signature: string;
  confirmed: boolean;
}

const DEFAULT_CU_LIMIT = 200_000;
const DEFAULT_MAX_RETRIES = 30;
const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * Build, sign, and send a transaction via HTTP RPC.
 * Polls for confirmation (no WebSocket).
 */
export async function sendTx(
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
  instructions: Instruction[],
  options: SendTxOptions = {},
): Promise<SendTxResult> {
  const {
    computeUnitLimit = DEFAULT_CU_LIMIT,
    computeUnitPrice,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = options;

  // Prepend compute budget instructions
  const allInstructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: computeUnitLimit }),
  ];

  if (computeUnitPrice !== undefined) {
    allInstructions.push(
      getSetComputeUnitPriceInstruction({ microLamports: computeUnitPrice }),
    );
  }

  allInstructions.push(...instructions);

  // Get recent blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build and sign transaction
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayerSigner(signer, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(allInstructions, msg),
  );

  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  const base64Tx = getBase64EncodedWireTransaction(signedTransaction);

  // Simulate first
  logger.debug("Simulating transaction with {cuLimit} CU, {cuPrice} priority", {
    cuLimit: computeUnitLimit,
    cuPrice: computeUnitPrice ?? "default",
  });

  const simResult = await rpc
    .simulateTransaction(base64Tx, { encoding: "base64" })
    .send();

  if (simResult.value.err) {
    logger.error("Transaction simulation failed: {error}", {
      error: simResult.value.err,
    });
    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(simResult.value.err)}`,
    );
  }

  // Send transaction
  const signature = await rpc
    .sendTransaction(base64Tx, { encoding: "base64" })
    .send();

  logger.debug("Transaction sent: {signature}", { signature });

  // Poll for confirmation
  let confirmed = false;
  for (let i = 0; i < maxRetries; i++) {
    logger.debug("Polling confirmation {attempt}/{maxRetries}", {
      attempt: i + 1,
      maxRetries,
    });
    const status = await rpc.getSignatureStatuses([signature]).send();

    if (status.value[0]?.err) {
      logger.error("Transaction failed on-chain: {error}", {
        error: status.value[0].err,
        signature,
      });
      throw new Error(
        `Transaction failed: ${JSON.stringify(status.value[0].err)}`,
      );
    }

    if (
      status.value[0]?.confirmationStatus === "confirmed" ||
      status.value[0]?.confirmationStatus === "finalized"
    ) {
      logger.debug("Transaction confirmed: {signature}", { signature });
      confirmed = true;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  if (!confirmed) {
    logger.warn(
      "Transaction not confirmed after {maxRetries} attempts: {signature}",
      { maxRetries, signature },
    );
  }

  return { signature, confirmed };
}
