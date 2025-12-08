import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { USDC_MINT, type Recipient } from "@cascade-fyi/splits-sdk";
import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfigFromVault,
  getVaultBalance,
  detectTokenProgram,
  labelToSeed,
  updateSplitConfig as updateSplitInstruction,
} from "@cascade-fyi/splits-sdk/solana";
import { VaultNotFoundError } from "@cascade-fyi/splits-sdk";
import { sendTx, type SendTxOptions } from "./internal/sendTx.js";
import { logger } from "./logger.js";

export type UpdateBlockedReason = "VAULT_NOT_EMPTY" | "UNCLAIMED_PENDING";

export type UpdateResult =
  | { status: "UPDATED"; signature: string }
  | { status: "NOT_FOUND" }
  | { status: "BLOCKED"; reason: UpdateBlockedReason; message: string }
  | { status: "FAILED"; message: string };

export interface UpdateParams {
  /** Human-readable label for PDA derivation */
  label: string;
  /** Token mint address (default: USDC) */
  mint?: Address;
  /** New recipients with share (1-100). Total must equal 100. A 1% protocol fee applies on distribution. */
  recipients: Recipient[];
  /** Priority fee in microlamports */
  computeUnitPrice?: bigint;
  /** Compute unit limit (default: 200_000) */
  computeUnitLimit?: number;
}

/**
 * Update split recipients.
 *
 * Explicit update (not idempotent like ensureSplit).
 * Requires vault to be empty and no unclaimed amounts.
 *
 * @returns Discriminated union result (never throws for business logic)
 */
export async function updateSplit(
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
  params: UpdateParams,
): Promise<UpdateResult> {
  const {
    label,
    mint = USDC_MINT,
    recipients,
    computeUnitPrice,
    computeUnitLimit,
  } = params;

  logger.debug("Updating split for label={label}, mint={mint}", {
    label,
    mint,
  });

  try {
    // 1. Derive addresses
    const seed = labelToSeed(label);
    const splitConfigAddress = await deriveSplitConfig(
      signer.address,
      mint,
      seed,
    );
    const tokenProgram = await detectTokenProgram(rpc, mint);
    const vaultAddress = await deriveVault(
      splitConfigAddress,
      mint,
      tokenProgram,
    );

    // 2. Check if config exists
    let existingConfig;
    try {
      existingConfig = await getSplitConfigFromVault(rpc, vaultAddress);
    } catch (e) {
      if (e instanceof VaultNotFoundError) {
        logger.debug("Split not found for label={label}", { label });
        return { status: "NOT_FOUND" };
      }
      throw e;
    }

    // 3. Check if update is possible
    const vaultBalance = await getVaultBalance(rpc, vaultAddress);
    if (vaultBalance > 0n) {
      logger.debug("Update blocked: vault has {balance} tokens", {
        balance: vaultBalance,
      });
      return {
        status: "BLOCKED",
        reason: "VAULT_NOT_EMPTY",
        message: `Vault has ${vaultBalance} tokens. Execute split first to empty the vault.`,
      };
    }

    const totalUnclaimed =
      existingConfig.unclaimedAmounts.reduce((sum, u) => sum + u.amount, 0n) +
      existingConfig.protocolUnclaimed;

    if (totalUnclaimed > 0n) {
      logger.debug("Update blocked: {unclaimed} tokens unclaimed", {
        unclaimed: totalUnclaimed,
      });
      return {
        status: "BLOCKED",
        reason: "UNCLAIMED_PENDING",
        message: `${totalUnclaimed} tokens unclaimed. Execute split first to clear unclaimed amounts.`,
      };
    }

    // 4. Build update instruction
    logger.debug("Building update instruction");
    const instruction = await updateSplitInstruction(rpc, {
      vault: vaultAddress,
      authority: signer.address,
      recipients,
      tokenProgram,
    });

    // 5. Send transaction
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
      [instruction],
      txOptions,
    );

    if (!confirmed) {
      logger.error("updateSplit failed: Transaction not confirmed", {
        signature,
      });
      return {
        status: "FAILED",
        message: `Transaction sent but not confirmed: ${signature}`,
      };
    }

    logger.info("Split updated: {signature}", { signature });
    return { status: "UPDATED", signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("updateSplit failed: {message}", { message });
    return {
      status: "FAILED",
      message,
    };
  }
}
