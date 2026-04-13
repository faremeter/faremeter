import {
  type Address,
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getAddressEncoder,
  getU64Encoder,
  AccountRole,
  type TransactionSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402SupportedKind,
  x402VerifyResponse,
} from "@faremeter/types/x402v2";
import type {
  FacilitatorHandler,
  GetRequirementsArgs,
} from "@faremeter/types/facilitator";
import { lookupX402Network } from "@faremeter/info/solana";
import { isValidationError } from "@faremeter/types";
import {
  generateMatcher,
  FLEX_SCHEME,
  FlexPaymentPayload,
  serializePaymentAuthorization,
  createEd25519VerifyInstruction,
  type SplitInput,
  fetchEscrowAccount,
  fetchSessionKey,
  findPendingSettlementsByEscrow,
  getSubmitAuthorizationInstructionAsync,
  getFinalizeInstructionDataEncoder,
  FLEX_PROGRAM_ADDRESS,
} from "@faremeter/flex-solana";
import { logger } from "../logger";
import {
  createHoldManager,
  mergeSplits,
  type Hold,
  type HoldManager,
} from "@faremeter/flex-solana/facilitator";
import type { EscrowAccountData, SessionKeyData } from "@faremeter/flex-solana";

const MS_PER_SLOT = 400;
const DEFAULT_MIN_GRACE_PERIOD_SLOTS = 150n;
const DEFAULT_CONFIRMATION_BUFFER_SLOTS = 75n;

// Anchor error codes that indicate the authorization can never succeed.
// These map to FlexError variants in programs/flex/src/error.rs.
const PERMANENT_SUBMIT_ERRORS = new Set([
  6000, // SessionKeyExpired
  6001, // SessionKeyRevoked
  6002, // AuthorizationExpired
  6003, // InvalidSignature
  6019, // InvalidEd25519Instruction
  6022, // InvalidSplitCount
  6023, // InvalidSplitBps
  6024, // SplitBpsZero
  6025, // DuplicateSplitRecipient
  6028, // SettleExceedsMax
  6029, // SettleAmountZero
  6030, // ExpiryTooFar
]);

function isPermanentSubmitError(error: string | undefined): boolean {
  if (!error) return false;
  const match = /"Custom":(\d+)/.exec(error);
  if (!match?.[1]) return false;
  return PERMANENT_SUBMIT_ERRORS.has(Number(match[1]));
}

const DEFAULT_SNAPSHOT_MAX_AGE_MS = 10_000;

type FlexFacilitatorConfig = {
  supportedMints: Address[];
  defaultSplits: { recipient: string; bps: number }[];
  maxSubmitRetries?: number;
  submitRetryDelayMs?: number;
  minGracePeriodSlots?: bigint;
  confirmationBufferSlots?: bigint;
  snapshotMaxAgeMs?: number;
  flushIntervalMs?: number;
};

type EscrowSnapshot = {
  account: EscrowAccountData;
  vaultByMint: Map<Address, bigint>;
  onChainCommittedByMint: Map<Address, bigint>;
  fetchedAtMs: number;
};

type CachedSessionKey = {
  data: SessionKeyData;
  fetchedAtMs: number;
};

/** Outcome of submitting a single hold to the on-chain program. */
export type FlushResult = {
  authorizationId: bigint;
  success: boolean;
  transaction?: string;
  error?: string;
};

/** Outcome of submitting a single hold to the on-chain program. */
type FinalizeResult = {
  authorizationId: bigint;
  success: boolean;
  transaction?: string;
  error?: string;
};

/**
 * Extended `FacilitatorHandler` with Flex-specific lifecycle
 * methods for flushing holds to chain and inspecting the hold manager.
 */
export type FlexFacilitator = FacilitatorHandler & {
  flush(): Promise<FlushResult[]>;
  getHoldManager(): HoldManager;
  stop(): void;
};

/**
 * Creates a facilitator handler that verifies Flex payment authorizations,
 * manages in-memory holds, and submits/finalizes settlements on-chain.
 *
 * Starts a background interval that periodically flushes settled holds
 * and finalizes confirmed transactions. Call `stop()` to clear it.
 *
 * @param network - Solana cluster name (e.g. "mainnet", "devnet")
 * @param rpc - Solana RPC client
 * @param facilitatorSigner - Transaction signer for the facilitator
 * @param config - Supported mints, splits, and timing configuration
 * @returns A `FlexFacilitator` with verify/settle/flush/stop methods
 */
export const createFacilitatorHandler = async (
  network: string,
  rpc: Rpc<SolanaRpcApi>,
  facilitatorSigner: TransactionSigner,
  config: FlexFacilitatorConfig,
): Promise<FlexFacilitator> => {
  const { maxSubmitRetries = 30, submitRetryDelayMs = 1000 } = config;
  const minGracePeriodSlots =
    config.minGracePeriodSlots ?? DEFAULT_MIN_GRACE_PERIOD_SLOTS;
  const confirmationBufferSlots =
    config.confirmationBufferSlots ?? DEFAULT_CONFIRMATION_BUFFER_SLOTS;
  const snapshotMaxAgeMs =
    config.snapshotMaxAgeMs ?? DEFAULT_SNAPSHOT_MAX_AGE_MS;
  const facilitatorAddress = facilitatorSigner.address;

  const solanaNetwork = lookupX402Network(network);
  const networkId = solanaNetwork.caip2;

  const matchers = config.supportedMints.map((mint) =>
    generateMatcher(network, mint),
  );

  const holdManager = createHoldManager();
  const escrowSnapshots = new Map<Address, EscrowSnapshot>();
  const sessionKeyCache = new Map<Address, CachedSessionKey>();

  let lastKnownSlot = 0n;
  let lastSlotFetchedAtMs = 0;

  async function refreshSlot(): Promise<bigint> {
    lastKnownSlot = await rpc.getSlot().send();
    lastSlotFetchedAtMs = Date.now();
    return lastKnownSlot;
  }

  function estimateCurrentSlot(): bigint {
    if (lastKnownSlot === 0n) throw new Error("Slot not yet fetched");
    const elapsedMs = Date.now() - lastSlotFetchedAtMs;
    return lastKnownSlot + BigInt(Math.floor(elapsedMs / MS_PER_SLOT));
  }

  async function getCachedSessionKey(
    pda: Address,
  ): Promise<SessionKeyData | null> {
    const cached = sessionKeyCache.get(pda);
    if (cached && Date.now() - cached.fetchedAtMs < 30_000) {
      return cached.data;
    }
    const data = await fetchSessionKey(rpc, pda);
    if (data) {
      sessionKeyCache.set(pda, { data, fetchedAtMs: Date.now() });
    } else {
      sessionKeyCache.delete(pda);
    }
    return data;
  }

  function isSessionKeyUsable(
    key: SessionKeyData,
    atSlot: bigint,
  ): { usable: true } | { usable: false; reason: string } {
    if (!key.active) {
      if (key.revokedAtSlot === null) {
        return { usable: false, reason: "Session key is not active" };
      }
      const graceEnd = key.revokedAtSlot + key.revocationGracePeriodSlots;
      if (atSlot >= graceEnd) {
        return {
          usable: false,
          reason: "Session key revocation grace period has expired",
        };
      }
    }

    if (key.expiresAtSlot !== null && atSlot >= key.expiresAtSlot) {
      return { usable: false, reason: "Session key has expired" };
    }

    return { usable: true };
  }

  function computeHoldDeadline(
    key: SessionKeyData,
    expiresAtSlot: bigint,
    currentSlot: bigint,
  ): bigint {
    const deadlines: bigint[] = [expiresAtSlot];

    if (key.expiresAtSlot !== null) {
      deadlines.push(key.expiresAtSlot);
    }

    if (key.active) {
      if (key.revocationGracePeriodSlots > 0n) {
        deadlines.push(currentSlot + key.revocationGracePeriodSlots);
      }
    } else if (key.revokedAtSlot !== null) {
      deadlines.push(key.revokedAtSlot + key.revocationGracePeriodSlots);
    }

    const earliest = deadlines.reduce((a, b) => (a < b ? a : b));
    return earliest - confirmationBufferSlots;
  }

  async function snapshotEscrow(
    escrowAddress: Address,
  ): Promise<EscrowSnapshot> {
    const [account, pendingResults] = await Promise.all([
      fetchEscrowAccount(rpc, escrowAddress),
      findPendingSettlementsByEscrow(rpc, escrowAddress),
      refreshSlot(),
    ]);

    if (!account) {
      throw new Error("Escrow account not found");
    }

    const vaultByMint = new Map<Address, bigint>();
    const onChainCommittedByMint = new Map<Address, bigint>();

    for (const p of pendingResults) {
      const current = onChainCommittedByMint.get(p.account.mint) ?? 0n;
      onChainCommittedByMint.set(p.account.mint, current + p.account.amount);
    }

    const balancePromises = config.supportedMints.map(async (mint) => {
      const [vault] = await deriveVaultPDA(escrowAddress, mint);
      try {
        const balance = await rpc.getTokenAccountBalance(vault).send();
        return { mint, amount: BigInt(balance.value.amount) };
      } catch {
        return { mint, amount: 0n };
      }
    });

    for (const { mint, amount } of await Promise.all(balancePromises)) {
      vaultByMint.set(mint, amount);
    }

    const snapshot: EscrowSnapshot = {
      account,
      vaultByMint,
      onChainCommittedByMint,
      fetchedAtMs: Date.now(),
    };
    escrowSnapshots.set(escrowAddress, snapshot);
    return snapshot;
  }

  async function buildSplits(
    payTo: string,
    mint: Address,
  ): Promise<{ recipient: string; bps: number }[]> {
    if (!payTo) return config.defaultSplits;
    const reservedBps = config.defaultSplits.reduce((sum, s) => sum + s.bps, 0);
    const [payToATA] = await deriveATA(address(payTo), mint);
    const receiverSplit = {
      recipient: payToATA as string,
      bps: 10_000 - reservedBps,
    };
    if (config.defaultSplits.length === 0) return [receiverSplit];
    const fixedSplits = await Promise.all(
      config.defaultSplits.map(async (s) => {
        const [ata] = await deriveATA(address(s.recipient), mint);
        return { recipient: ata as string, bps: s.bps };
      }),
    );
    return mergeSplits([receiverSplit, ...fixedSplits]);
  }

  const isMatchingRequirement = (req: {
    scheme: string;
    network: string;
    asset: string;
  }) => matchers.some((m) => m.isMatchingRequirement(req));

  const getSupported = (): Promise<x402SupportedKind>[] => [
    Promise.resolve({
      x402Version: 2 as const,
      scheme: FLEX_SCHEME,
      network: networkId,
      extra: {
        facilitator: facilitatorAddress,
        supportedMints: config.supportedMints,
        splits: config.defaultSplits,
        minGracePeriodSlots: minGracePeriodSlots.toString(),
      },
    }),
  ];

  const getRequirements = async (
    args: GetRequirementsArgs,
  ): Promise<x402PaymentRequirements[]> => {
    const compatible = args.accepts.filter(isMatchingRequirement);
    return Promise.all(
      compatible.map(async (r) => ({
        ...r,
        extra: {
          facilitator: facilitatorAddress,
          supportedMints: config.supportedMints,
          splits: await buildSplits(r.payTo, address(r.asset)),
          minGracePeriodSlots: minGracePeriodSlots.toString(),
        },
      })),
    );
  };

  const addressEncoder = getAddressEncoder();
  const u64Encoder = getU64Encoder();
  const textEncoder = new TextEncoder();

  const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ASSOCIATED_TOKEN_PROGRAM = address(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );

  const deriveATA = (wallet: Address, mint: Address) =>
    getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      seeds: [
        addressEncoder.encode(wallet),
        addressEncoder.encode(TOKEN_PROGRAM),
        addressEncoder.encode(mint),
      ],
    });

  const deriveSessionKeyPDA = (escrow: Address, sessionKey: Address) =>
    getProgramDerivedAddress({
      programAddress: FLEX_PROGRAM_ADDRESS,
      seeds: [
        textEncoder.encode("session"),
        addressEncoder.encode(escrow),
        addressEncoder.encode(sessionKey),
      ],
    });

  const deriveVaultPDA = (escrow: Address, mint: Address) =>
    getProgramDerivedAddress({
      programAddress: FLEX_PROGRAM_ADDRESS,
      seeds: [
        textEncoder.encode("token"),
        addressEncoder.encode(escrow),
        addressEncoder.encode(mint),
      ],
    });

  const derivePendingPDA = (escrow: Address, authorizationId: bigint) =>
    getProgramDerivedAddress({
      programAddress: FLEX_PROGRAM_ADDRESS,
      seeds: [
        textEncoder.encode("pending"),
        addressEncoder.encode(escrow),
        u64Encoder.encode(authorizationId),
      ],
    });

  const parseAndVerifyPayload = async (payment: x402PaymentPayload) => {
    const parseResult = FlexPaymentPayload(payment.payload);
    if (isValidationError(parseResult)) {
      return { error: `Invalid flex payload: ${parseResult.summary}` };
    }

    const escrowAddress = address(parseResult.escrow);
    const mint = address(parseResult.mint);
    const maxAmount = BigInt(parseResult.maxAmount);
    const authorizationId = BigInt(parseResult.authorizationId);
    const expiresAtSlot = BigInt(parseResult.expiresAtSlot);
    const sessionKeyAddress = address(parseResult.sessionKey);

    const signatureBytes = Uint8Array.from(atob(parseResult.signature), (c) =>
      c.charCodeAt(0),
    );

    const splits: SplitInput[] = parseResult.splits.map((s) => ({
      recipient: address(s.recipient),
      bps: s.bps,
    }));

    const cached = escrowSnapshots.get(escrowAddress);
    const snapshot =
      cached && Date.now() - cached.fetchedAtMs < snapshotMaxAgeMs
        ? cached
        : await snapshotEscrow(escrowAddress);

    if (snapshot.account.facilitator !== facilitatorAddress) {
      return { error: "Escrow facilitator does not match" };
    }

    if (snapshot.account.refundTimeoutSlots <= confirmationBufferSlots) {
      return {
        error: `Escrow refund timeout (${snapshot.account.refundTimeoutSlots}) too short for confirmation buffer (${confirmationBufferSlots})`,
      };
    }

    const [sessionKeyPDA] = await deriveSessionKeyPDA(
      escrowAddress,
      sessionKeyAddress,
    );
    const sessionKeyData = await getCachedSessionKey(sessionKeyPDA);
    if (!sessionKeyData) {
      return { error: "Session key not found" };
    }

    if (sessionKeyData.revocationGracePeriodSlots < minGracePeriodSlots) {
      return {
        error: `Session key grace period ${sessionKeyData.revocationGracePeriodSlots} below minimum ${minGracePeriodSlots}`,
      };
    }

    const currentSlot = estimateCurrentSlot();
    const usability = isSessionKeyUsable(sessionKeyData, currentSlot);
    if (!usability.usable) {
      sessionKeyCache.delete(sessionKeyPDA);
      return { error: usability.reason };
    }

    if (currentSlot >= expiresAtSlot) {
      return { error: "Authorization has already expired" };
    }

    if (expiresAtSlot < currentSlot + confirmationBufferSlots) {
      return {
        error: "Authorization expires too soon for on-chain submission",
      };
    }

    if (expiresAtSlot > currentSlot + snapshot.account.refundTimeoutSlots) {
      return { error: "Authorization expiry exceeds refund timeout" };
    }

    const validUntilSlot = computeHoldDeadline(
      sessionKeyData,
      expiresAtSlot,
      currentSlot,
    );
    if (currentSlot >= validUntilSlot) {
      return {
        error: "Session key validity window too short for settlement",
      };
    }

    const [vault] = await deriveVaultPDA(escrowAddress, mint);
    const vaultAmount = snapshot.vaultByMint.get(mint) ?? 0n;
    const onChainCommitted = snapshot.onChainCommittedByMint.get(mint) ?? 0n;

    const message = serializePaymentAuthorization({
      programId: FLEX_PROGRAM_ADDRESS,
      escrow: escrowAddress,
      mint,
      maxAmount,
      authorizationId,
      expiresAtSlot,
      splits,
    });

    const publicKeyBytes = addressEncoder.encode(sessionKeyAddress);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      "Ed25519",
      false,
      ["verify"],
    );
    const isValid = await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      signatureBytes,
      message,
    );

    if (!isValid) {
      return { error: "Ed25519 signature verification failed" };
    }

    return {
      escrowAddress,
      escrowAccount: snapshot.account,
      mint,
      maxAmount,
      authorizationId,
      expiresAtSlot,
      sessionKeyAddress,
      sessionKeyPDA,
      vault,
      splits,
      signatureBytes,
      message,
      payer: snapshot.account.owner,
      vaultAmount,
      onChainCommitted,
      validUntilSlot,
    };
  };

  const handleVerify = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ): Promise<x402VerifyResponse | null> => {
    if (!isMatchingRequirement(requirements)) {
      return null;
    }

    const result = await parseAndVerifyPayload(payment);

    if ("error" in result) {
      return { isValid: false, invalidReason: result.error };
    }

    // Create hold at maxAmount to reserve funds and prevent replay.
    // The settle step will reduce settleAmount to the actual cost.
    const holdResult = holdManager.tryHold(
      {
        escrow: result.escrowAddress,
        mint: result.mint,
        settleAmount: result.maxAmount,
        maxAmount: result.maxAmount,
        authorizationId: result.authorizationId,
        expiresAtSlot: result.expiresAtSlot,
        sessionKeyAddress: result.sessionKeyAddress,
        sessionKeyPDA: result.sessionKeyPDA,
        vault: result.vault,
        splits: result.splits,
        signatureBytes: result.signatureBytes,
        message: result.message,
        payer: result.payer,
        validUntilSlot: result.validUntilSlot,
      },
      result.vaultAmount,
      result.onChainCommitted,
      result.escrowAccount.pendingCount,
    );

    if (!holdResult.ok) {
      return { isValid: false, invalidReason: holdResult.reason };
    }

    return { isValid: true, payer: result.payer };
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ): Promise<x402SettleResponse | null> => {
    if (!isMatchingRequirement(requirements)) {
      return null;
    }

    const errorResponse = (msg: string): x402SettleResponse => {
      logger.error(msg);
      return {
        success: false,
        errorReason: msg,
        transaction: "",
        network: networkId,
      };
    };

    const result = await parseAndVerifyPayload(payment);

    if ("error" in result) {
      return errorResponse(result.error);
    }

    const settleAmount = BigInt(requirements.amount);

    if (settleAmount > result.maxAmount) {
      return errorResponse("Settle amount exceeds client-authorized maxAmount");
    }

    // Update the hold created during verify with the actual settle amount.
    // If no hold exists (settle called without prior verify), create one.
    const updateResult = holdManager.updateSettleAmount(
      result.escrowAddress,
      result.authorizationId,
      settleAmount,
    );

    if (updateResult.ok) {
      return {
        success: true,
        transaction: result.authorizationId.toString(),
        network: networkId,
        payer: result.payer,
      };
    }

    if (!updateResult.ok && updateResult.reason !== "Hold not found") {
      return errorResponse(updateResult.reason);
    }

    // No existing hold -- fall back to creating one (direct settle path)
    const holdResult = holdManager.tryHold(
      {
        escrow: result.escrowAddress,
        mint: result.mint,
        settleAmount,
        maxAmount: result.maxAmount,
        authorizationId: result.authorizationId,
        expiresAtSlot: result.expiresAtSlot,
        sessionKeyAddress: result.sessionKeyAddress,
        sessionKeyPDA: result.sessionKeyPDA,
        vault: result.vault,
        splits: result.splits,
        signatureBytes: result.signatureBytes,
        message: result.message,
        payer: result.payer,
        validUntilSlot: result.validUntilSlot,
      },
      result.vaultAmount,
      result.onChainCommitted,
      result.escrowAccount.pendingCount,
    );

    if (!holdResult.ok) {
      return errorResponse(holdResult.reason);
    }

    holdManager.updateSettleAmount(
      result.escrowAddress,
      result.authorizationId,
      settleAmount,
    );

    return {
      success: true,
      transaction: result.authorizationId.toString(),
      network: networkId,
      payer: result.payer,
    };
  };

  async function submitHold(hold: Hold): Promise<FlushResult> {
    const [pending] = await derivePendingPDA(hold.escrow, hold.authorizationId);

    const ed25519Ix = createEd25519VerifyInstruction({
      publicKey: hold.sessionKeyAddress,
      message: hold.message,
      signature: hold.signatureBytes,
    });

    const submitIx = await getSubmitAuthorizationInstructionAsync({
      escrow: hold.escrow,
      facilitator: facilitatorSigner,
      sessionKey: hold.sessionKeyPDA,
      tokenAccount: hold.vault,
      pending,
      mint: hold.mint,
      maxAmount: hold.maxAmount,
      settleAmount: hold.settleAmount,
      authorizationId: hold.authorizationId,
      expiresAtSlot: hold.expiresAtSlot,
      splits: hold.splits.map((s) => ({
        recipient: s.recipient,
        bps: s.bps,
      })),
    });

    const {
      value: { blockhash, lastValidBlockHeight },
    } = await rpc.getLatestBlockhash().send();

    const txMessage = appendTransactionMessageInstructions(
      [ed25519Ix, submitIx],
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight },
        setTransactionMessageFeePayerSigner(
          facilitatorSigner,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const txSignature = getSignatureFromTransaction(signedTx);

    const wireTransaction = getBase64EncodedWireTransaction(signedTx);
    await rpc.sendTransaction(wireTransaction, { encoding: "base64" }).send();

    for (let i = 0; i < maxSubmitRetries; i++) {
      const status = await rpc.getSignatureStatuses([txSignature]).send();
      const statusValue = status.value[0];
      if (statusValue?.err) {
        return {
          authorizationId: hold.authorizationId,
          success: false,
          error: `Transaction failed: ${JSON.stringify(statusValue.err)}`,
        };
      }
      if (
        statusValue?.confirmationStatus === "confirmed" ||
        statusValue?.confirmationStatus === "finalized"
      ) {
        return {
          authorizationId: hold.authorizationId,
          success: true,
          transaction: txSignature,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, submitRetryDelayMs));
    }

    return {
      authorizationId: hold.authorizationId,
      success: false,
      error: "Transaction confirmation timeout",
    };
  }

  async function flush(): Promise<FlushResult[]> {
    const currentSlot = estimateCurrentSlot();
    const expired = holdManager.sweepExpired(currentSlot);
    for (const h of expired) {
      logger.warning(
        `hold expired before flush: authorizationId=${h.authorizationId} validUntilSlot=${h.validUntilSlot}`,
      );
    }

    const batch = holdManager.drainSubmittable(currentSlot);
    if (batch.length === 0) return [];

    const escrowsToRefresh = new Set<Address>();

    const settled = await Promise.allSettled(
      batch.map(async (hold): Promise<FlushResult> => {
        try {
          return await submitHold(hold);
        } catch (cause) {
          return {
            authorizationId: hold.authorizationId,
            success: false,
            error:
              cause instanceof Error
                ? cause.message
                : "Unknown submission error",
          };
        }
      }),
    );

    const results: FlushResult[] = [];
    for (const [i, hold] of batch.entries()) {
      const outcome = settled[i];
      const result: FlushResult =
        outcome?.status === "fulfilled"
          ? outcome.value
          : {
              authorizationId: hold.authorizationId,
              success: false,
              error:
                outcome?.status === "rejected" &&
                outcome.reason instanceof Error
                  ? outcome.reason.message
                  : "Unknown submission error",
            };
      results.push(result);

      if (result.success) {
        if (
          !holdManager.markSubmitted(
            hold.escrow,
            hold.authorizationId,
            currentSlot,
          )
        ) {
          logger.warning(
            `markSubmitted returned false for authorizationId ${hold.authorizationId}`,
          );
        }
        escrowsToRefresh.add(hold.escrow);
      } else {
        logger.error(
          `submission failed for authorizationId ${hold.authorizationId}: ${result.error}`,
        );

        if (isPermanentSubmitError(result.error)) {
          holdManager.releaseHold(hold.escrow, hold.authorizationId);
        } else {
          const retries = holdManager.markFailed(
            hold.escrow,
            hold.authorizationId,
          );
          if (retries < 0 || retries >= maxSubmitRetries) {
            if (retries >= maxSubmitRetries) {
              logger.error(
                `giving up on authorizationId ${hold.authorizationId} after ${retries} attempts`,
              );
            }
            holdManager.releaseHold(hold.escrow, hold.authorizationId);
          }
        }
        escrowSnapshots.delete(hold.escrow);
      }
    }

    await Promise.all(
      [...escrowsToRefresh].map((escrow) => snapshotEscrow(escrow)),
    );

    return results;
  }

  async function finalizeHold(hold: Hold): Promise<FinalizeResult> {
    const [pending] = await derivePendingPDA(hold.escrow, hold.authorizationId);

    const ix = {
      programAddress: FLEX_PROGRAM_ADDRESS,
      data: getFinalizeInstructionDataEncoder().encode({}),
      accounts: [
        { address: hold.escrow, role: AccountRole.WRITABLE as const },
        {
          address: facilitatorSigner.address,
          role: AccountRole.WRITABLE_SIGNER as const,
          signer: facilitatorSigner,
        },
        { address: pending, role: AccountRole.WRITABLE as const },
        { address: hold.vault, role: AccountRole.WRITABLE as const },
        { address: TOKEN_PROGRAM, role: AccountRole.READONLY as const },
        ...hold.splits.map((s) => ({
          address: s.recipient,
          role: AccountRole.WRITABLE as const,
        })),
      ],
    };

    const {
      value: { blockhash, lastValidBlockHeight },
    } = await rpc.getLatestBlockhash().send();

    const txMessage = appendTransactionMessageInstructions(
      [ix],
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight },
        setTransactionMessageFeePayerSigner(
          facilitatorSigner,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const txSignature = getSignatureFromTransaction(signedTx);

    const wireTransaction = getBase64EncodedWireTransaction(signedTx);
    await rpc.sendTransaction(wireTransaction, { encoding: "base64" }).send();

    for (let i = 0; i < maxSubmitRetries; i++) {
      const status = await rpc.getSignatureStatuses([txSignature]).send();
      const statusValue = status.value[0];
      if (statusValue?.err) {
        return {
          authorizationId: hold.authorizationId,
          success: false,
          error: `Transaction failed: ${JSON.stringify(statusValue.err)}`,
        };
      }
      if (
        statusValue?.confirmationStatus === "confirmed" ||
        statusValue?.confirmationStatus === "finalized"
      ) {
        return {
          authorizationId: hold.authorizationId,
          success: true,
          transaction: txSignature,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, submitRetryDelayMs));
    }

    return {
      authorizationId: hold.authorizationId,
      success: false,
      error: "Transaction confirmation timeout",
    };
  }

  function getRefundTimeout(escrow: Address): bigint | null {
    const snapshot = escrowSnapshots.get(escrow);
    if (!snapshot) return null;
    return snapshot.account.refundTimeoutSlots + confirmationBufferSlots;
  }

  function extractErrorMessage(cause: unknown): string {
    if (!(cause instanceof Error)) return String(cause);
    const context =
      "context" in cause
        ? ` context=${JSON.stringify((cause as { context: unknown }).context, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`
        : "";
    const causeChain =
      cause.cause instanceof Error ? ` cause=${cause.cause.message}` : "";
    return `${cause.message}${context}${causeChain}`;
  }

  async function finalizeReady(): Promise<FinalizeResult[]> {
    const currentSlot = estimateCurrentSlot();
    const batch = holdManager.drainFinalizable(currentSlot, getRefundTimeout);
    if (batch.length === 0) return [];

    const settled = await Promise.allSettled(
      batch.map(async (hold): Promise<FinalizeResult> => {
        try {
          return await finalizeHold(hold);
        } catch (cause) {
          return {
            authorizationId: hold.authorizationId,
            success: false,
            error: extractErrorMessage(cause),
          };
        }
      }),
    );

    const results: FinalizeResult[] = [];
    for (const [i, hold] of batch.entries()) {
      const outcome = settled[i];
      const result: FinalizeResult =
        outcome?.status === "fulfilled"
          ? outcome.value
          : {
              authorizationId: hold.authorizationId,
              success: false,
              error:
                outcome?.status === "rejected"
                  ? extractErrorMessage(outcome.reason)
                  : "Unknown finalization error",
            };
      results.push(result);

      if (result.success) {
        if (!holdManager.markFinalized(hold.escrow, hold.authorizationId)) {
          logger.warning(
            `markFinalized returned false for authorizationId ${hold.authorizationId}`,
          );
        }
      } else {
        logger.error(
          `finalization failed for authorizationId ${hold.authorizationId}: ${result.error}`,
        );
        holdManager.resetToSubmitted(hold.escrow, hold.authorizationId);
      }
    }

    return results;
  }

  await refreshSlot();

  const flushIntervalMs = config.flushIntervalMs ?? 2000;
  let tickRunning = false;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const interval = setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const flushResults = await flush();
      for (const r of flushResults) {
        if (r.success) {
          logger.info(
            `flushed authorizationId=${r.authorizationId} tx=${r.transaction}`,
          );
        } else {
          logger.error(
            `flush failed authorizationId=${r.authorizationId}: ${r.error}`,
          );
        }
      }

      const finalizeResults = await finalizeReady();
      for (const r of finalizeResults) {
        if (r.success) {
          logger.info(
            `finalized authorizationId=${r.authorizationId} tx=${r.transaction}`,
          );
        } else {
          logger.error(
            `finalize failed authorizationId=${r.authorizationId}: ${r.error}`,
          );
        }
      }
    } catch (cause: unknown) {
      logger.error(
        `tick error: ${cause instanceof Error ? cause.message : cause}`,
      );
    } finally {
      tickRunning = false;
    }
  }, flushIntervalMs);

  const stop = () => clearInterval(interval);

  return {
    getSupported,
    getRequirements,
    handleVerify,
    handleSettle,
    flush,
    getHoldManager: () => holdManager,
    stop,
  };
};
