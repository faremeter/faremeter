import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import {
  isCascadeSplit,
  executeSplit as executeSplitInstruction,
  getVaultBalance,
  getSplitConfigAddressFromVault,
  VaultNotFoundError,
} from "@cascade-fyi/splits-sdk/core";
import { sendTx, type SendTxOptions } from "./internal/sendTx.js";
import { logger } from "./logger.js";

export type SkippedReason = "NOT_A_SPLIT" | "EMPTY_VAULT" | "BELOW_THRESHOLD";

export type ExecuteResult =
  | { status: "EXECUTED"; signature: string }
  | { status: "SKIPPED"; reason: SkippedReason }
  | { status: "FAILED"; message: string };

export interface ExecuteParams {
  /** The split vault address (ATA derived from splitConfig + mint) */
  vault: Address;
  /** Minimum vault balance to trigger execution (default: 0) */
  minBalance?: bigint;
  /** Priority fee in microlamports */
  computeUnitPrice?: bigint;
  /** Compute unit limit (default: 200_000) */
  computeUnitLimit?: number;
}

/**
 * Execute a split distribution.
 *
 * Distributes vault balance to recipients according to their shares.
 * A 1% protocol fee is deducted; recipients receive the remaining 99%.
 * Anyone can call this - it's permissionless.
 *
 * @returns Discriminated union result (never throws for business logic)
 */
export async function executeSplit(
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
  params: ExecuteParams,
): Promise<ExecuteResult> {
  const { vault, minBalance = 0n, computeUnitPrice, computeUnitLimit } = params;

  logger.debug("Executing split for vault={vault}", { vault });

  try {
    // Get splitConfig from vault (validates it's a token account with an owner)
    let splitConfig: Address;
    try {
      splitConfig = await getSplitConfigAddressFromVault(rpc, vault);
    } catch (e) {
      if (e instanceof VaultNotFoundError) {
        logger.debug("Vault not found or not a token account");
        return { status: "SKIPPED", reason: "NOT_A_SPLIT" };
      }
      throw e;
    }

    // Check if it's actually a Cascade split
    const isSplit = await isCascadeSplit(rpc, splitConfig);
    if (!isSplit) {
      logger.debug("Vault is not a Cascade split");
      return { status: "SKIPPED", reason: "NOT_A_SPLIT" };
    }

    // Check minimum balance threshold
    const balance = await getVaultBalance(rpc, vault);
    if (balance === 0n) {
      logger.debug("Vault is empty, skipping");
      return { status: "SKIPPED", reason: "EMPTY_VAULT" };
    }
    if (balance < minBalance) {
      logger.debug("Vault balance {balance} below threshold {minBalance}", {
        balance,
        minBalance,
      });
      return { status: "SKIPPED", reason: "BELOW_THRESHOLD" };
    }

    // Build execute instruction
    logger.debug("Building execute instruction for balance={balance}", {
      balance,
    });
    const execResult = await executeSplitInstruction({
      rpc,
      splitConfig,
      executor: signer.address,
    });
    if (execResult.status !== "success") {
      const reason =
        execResult.status === "not_found"
          ? "Split config not found"
          : "Not a cascade split";
      logger.error("executeSplit failed: {reason}", { reason });
      return { status: "FAILED", message: reason };
    }

    // Send transaction
    const txOptions: SendTxOptions = {};
    if (computeUnitPrice !== undefined) {
      txOptions.computeUnitPrice = computeUnitPrice;
    }
    if (computeUnitLimit !== undefined) {
      txOptions.computeUnitLimit = computeUnitLimit;
    }

    const { signature, confirmed } = await sendTx(
      rpc,
      signer,
      [execResult.instruction],
      txOptions,
    );

    if (!confirmed) {
      logger.error("executeSplit failed: Transaction not confirmed", {
        signature,
      });
      return {
        status: "FAILED",
        message: `Transaction sent but not confirmed: ${signature}`,
      };
    }

    logger.info("Split executed: {signature}", { signature });
    return { status: "EXECUTED", signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("executeSplit failed: {message}", { message });
    return {
      status: "FAILED",
      message,
    };
  }
}
