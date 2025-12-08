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
  recipientsEqual,
  detectTokenProgram,
  labelToSeed,
  createSplitConfig,
  updateSplitConfig,
} from "@cascade-fyi/splits-sdk/solana";
import { VaultNotFoundError } from "@cascade-fyi/splits-sdk";
import { sendTx, type SendTxOptions } from "./internal/sendTx.js";
import { logger } from "./logger.js";

export type BlockedReason = "VAULT_NOT_EMPTY" | "UNCLAIMED_PENDING";

export type EnsureResult =
  | {
      status: "CREATED";
      splitConfig: Address;
      vault: Address;
      signature: string;
    }
  | {
      status: "UPDATED";
      splitConfig: Address;
      vault: Address;
      signature: string;
    }
  | {
      status: "NO_CHANGE";
      splitConfig: Address;
      vault: Address;
    }
  | {
      status: "BLOCKED";
      reason: BlockedReason;
      message: string;
    }
  | {
      status: "FAILED";
      message: string;
    };

export interface EnsureParams {
  /** Human-readable label for PDA derivation (e.g., "product-123") */
  label: string;
  /** Token mint address (default: USDC) */
  mint?: Address;
  /** Recipients with share (1-100). Total must equal 100. A 1% protocol fee is deducted on each distribution. */
  recipients: Recipient[];
  /** Priority fee in microlamports */
  computeUnitPrice?: bigint;
  /** Compute unit limit (default: 200_000) */
  computeUnitLimit?: number;
}

/**
 * Ensure a split exists with the specified recipients.
 *
 * A 1% protocol fee is automatically deducted from each distribution.
 * Recipients receive 99% of payments proportional to their shares.
 *
 * Idempotent operation:
 * - If split doesn't exist → creates it (CREATED)
 * - If split exists with same recipients → no-op (NO_CHANGE)
 * - If split exists with different recipients → updates if possible (UPDATED), or (BLOCKED)
 *
 * @returns Discriminated union result (never throws for business logic)
 */
export async function ensureSplit(
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
  params: EnsureParams,
): Promise<EnsureResult> {
  const {
    label,
    mint = USDC_MINT,
    recipients,
    computeUnitPrice,
    computeUnitLimit,
  } = params;

  logger.debug("Ensuring split for label={label}, mint={mint}", {
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
    let existingConfig = null;
    try {
      existingConfig = await getSplitConfigFromVault(rpc, vaultAddress);
    } catch (e) {
      if (!(e instanceof VaultNotFoundError)) throw e;
      logger.debug("Split config not found, will create");
    }

    // 3. If exists, check for NO_CHANGE or UPDATE
    if (existingConfig) {
      // Check set equality (order-independent)
      if (recipientsEqual(recipients, existingConfig.recipients)) {
        logger.debug("Recipients unchanged, no action needed");
        return {
          status: "NO_CHANGE",
          vault: vaultAddress,
          splitConfig: splitConfigAddress,
        };
      }

      // Check if update is possible
      const vaultBalance = await getVaultBalance(rpc, vaultAddress);
      if (vaultBalance > 0n) {
        logger.debug("Update blocked: vault has {balance} tokens", {
          balance: vaultBalance,
        });
        return {
          status: "BLOCKED",
          reason: "VAULT_NOT_EMPTY",
          message: `Vault has ${vaultBalance} tokens. Execute split first to empty the vault before updating.`,
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

      // Build update instruction
      logger.debug("Updating split config with new recipients");
      const instruction = await updateSplitConfig(rpc, {
        vault: vaultAddress,
        authority: signer.address,
        recipients,
        tokenProgram,
      });

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
        [instruction],
        txOptions,
      );

      if (!confirmed) {
        logger.error("ensureSplit failed: Update transaction not confirmed", {
          signature,
        });
        return {
          status: "FAILED",
          message: `Update transaction sent but not confirmed: ${signature}`,
        };
      }

      logger.info("Split updated: {splitConfig}", {
        splitConfig: splitConfigAddress,
      });
      return {
        status: "UPDATED",
        vault: vaultAddress,
        splitConfig: splitConfigAddress,
        signature,
      };
    }

    // 4. Create new config
    logger.debug("Creating new split config");
    const { instruction } = await createSplitConfig({
      authority: signer.address,
      recipients,
      mint,
      uniqueId: seed,
      tokenProgram,
      payer: signer.address,
    });

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
      [instruction],
      txOptions,
    );

    if (!confirmed) {
      logger.error("ensureSplit failed: Create transaction not confirmed", {
        signature,
      });
      return {
        status: "FAILED",
        message: `Create transaction sent but not confirmed: ${signature}`,
      };
    }

    logger.info("Split created: {splitConfig}", {
      splitConfig: splitConfigAddress,
    });
    return {
      status: "CREATED",
      vault: vaultAddress,
      splitConfig: splitConfigAddress,
      signature,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("ensureSplit failed: {message}", { message });
    return {
      status: "FAILED",
      message,
    };
  }
}
