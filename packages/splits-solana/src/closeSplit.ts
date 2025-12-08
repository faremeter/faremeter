import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { USDC_MINT } from "@cascade-fyi/splits-sdk";
import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfigFromVault,
  getVaultBalance,
  detectTokenProgram,
  labelToSeed,
  closeSplitConfig,
} from "@cascade-fyi/splits-sdk/solana";
import { VaultNotFoundError } from "@cascade-fyi/splits-sdk";
import { sendTx, type SendTxOptions } from "./internal/sendTx.js";
import { logger } from "./logger.js";

export type CloseBlockedReason = "VAULT_NOT_EMPTY" | "UNCLAIMED_PENDING";

export type CloseResult =
  | { status: "CLOSED"; signature: string }
  | { status: "NOT_FOUND" }
  | { status: "BLOCKED"; reason: CloseBlockedReason; message: string }
  | { status: "FAILED"; message: string };

export interface CloseParams {
  /** Human-readable label for PDA derivation */
  label: string;
  /** Token mint address (default: USDC) */
  mint?: Address;
  /** Address to receive recovered rent (defaults to signer) */
  rentReceiver?: Address;
  /** Priority fee in microlamports */
  computeUnitPrice?: bigint;
  /** Compute unit limit (default: 200_000) */
  computeUnitLimit?: number;
}

/**
 * Close a split and recover rent.
 *
 * Requires vault to be empty and no unclaimed amounts.
 *
 * @returns Discriminated union result (never throws for business logic)
 */
export async function closeSplit(
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
  params: CloseParams,
): Promise<CloseResult> {
  const {
    label,
    mint = USDC_MINT,
    rentReceiver,
    computeUnitPrice,
    computeUnitLimit,
  } = params;

  logger.debug("Closing split for label={label}, mint={mint}", { label, mint });

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

    // 3. Check if close is possible
    const vaultBalance = await getVaultBalance(rpc, vaultAddress);
    if (vaultBalance > 0n) {
      logger.debug("Close blocked: vault has {balance} tokens", {
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
      logger.debug("Close blocked: {unclaimed} tokens unclaimed", {
        unclaimed: totalUnclaimed,
      });
      return {
        status: "BLOCKED",
        reason: "UNCLAIMED_PENDING",
        message: `${totalUnclaimed} tokens unclaimed. Execute split first to clear unclaimed amounts.`,
      };
    }

    // 4. Build close instruction
    logger.debug("Building close instruction");
    const instruction = await closeSplitConfig(rpc, {
      vault: vaultAddress,
      authority: signer.address,
      rentReceiver: rentReceiver ?? signer.address,
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
      logger.error("closeSplit failed: Transaction not confirmed", {
        signature,
      });
      return {
        status: "FAILED",
        message: `Transaction sent but not confirmed: ${signature}`,
      };
    }

    logger.info("Split closed: {signature}", { signature });
    return { status: "CLOSED", signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("closeSplit failed: {message}", { message });
    return {
      status: "FAILED",
      message,
    };
  }
}
