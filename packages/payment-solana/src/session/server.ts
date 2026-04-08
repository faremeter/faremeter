import type {
  MPPMethodHandler,
  ChallengeOpts,
  mppChallengeParams,
  mppCredential,
  mppReceipt,
  verificationFailedProblem,
} from "@faremeter/types/mpp";
import {
  encodeBase64URL,
  canonicalizeSortedJSON,
  decodeBase64URL,
  formatWWWAuthenticate,
  generateChallengeID,
  verifyChallengeID,
  SESSION_INTENT,
} from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";
import { isValidationError } from "@faremeter/types";
import {
  caip2ToCluster,
  lookupX402Network,
  type SolanaCAIP2Network,
} from "@faremeter/info/solana";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../splToken";
import {
  address,
  getAddressEncoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { solanaSessionPayload, solanaSessionRequest } from "./common";
import type {
  flexVoucherExtension,
  solanaSessionMethodDetails,
  solanaSignedVoucher,
} from "./common";
import {
  createInMemorySessionStore,
  type SessionState,
  type SessionStore,
} from "./state";
import bs58 from "bs58";
import {
  serializeSpecVoucherMessage,
  serializeVoucherMessage,
  verifyVoucherSignature,
} from "./verify";
import { verifyFlexOpenTransaction } from "./verify-open";

/**
 * Throws if `actual` does not match `expected` as a splits array.
 * Equality is position- and value-sensitive. Used to enforce that a
 * signed Flex voucher's splits match the challenge's `defaultSplits`.
 */
function assertSplitsMatch(
  expected: { recipient: string; bps: number }[],
  actual: { recipient: string; bps: number }[],
): void {
  if (expected.length !== actual.length) {
    throw new Error(
      `voucher splits length ${actual.length} does not match challenge defaultSplits length ${expected.length}`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === undefined || a === undefined) {
      throw new Error("voucher splits contain undefined entry");
    }
    if (e.recipient !== a.recipient || e.bps !== a.bps) {
      throw new Error(
        `voucher split ${i} (${a.recipient}/${a.bps}bps) does not match challenge defaultSplits (${e.recipient}/${e.bps}bps)`,
      );
    }
  }
}

function addressToBytes(addr: Address): Uint8Array<ArrayBuffer> {
  const encoded = getAddressEncoder().encode(addr);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
import {
  PENDING_LIMIT_MAX,
  buildInsufficientHoldProblem,
  buildPendingLimitProblem,
  buildSessionNotFoundProblem,
  type flexPendingLimitProblem,
} from "./problem";
import { logger } from "./logger";

/**
 * Reason returned by `tryRegisterVoucher` when a voucher cannot be
 * accepted. Each reason maps to a spec Problem Details type in the
 * middleware body callback so spec-conforming clients see
 * `verification-failed` (or a Faremeter-namespaced extension) with
 * the right `detail`.
 */
export type VoucherRegistrationReason =
  | "pending-limit"
  | "session-not-found"
  | "channel-closed"
  | "insufficient-hold"
  | "signer-mismatch";

/**
 * Typed error thrown by `handleSettle` when a voucher submission
 * fails a spec verification step. The middleware body callback can
 * distinguish failure modes by `instanceof` + `reason` and build the
 * appropriate Problem Details response.
 */
export class VoucherRegistrationError extends Error {
  readonly reason: VoucherRegistrationReason;
  constructor(reason: VoucherRegistrationReason) {
    super(`voucher registration failed: ${reason}`);
    this.name = "VoucherRegistrationError";
    this.reason = reason;
  }
}

export type VoucherRegistration = {
  channelId: Address;
  sessionKey: Address;
  voucher: solanaSignedVoucher;
  /**
   * Flex authorization extension, OPTIONAL. When present, the
   * `authorizationId` is tracked against the escrow's in-flight
   * pending-settlement cap. Absent extensions still advance the
   * off-chain `acceptedCumulative` but will never be settled on
   * chain — spec-conforming voucher submissions that skip the Flex
   * extension are acceptable for metered off-chain state but not
   * for Flex settlement.
   */
  flex?: flexVoucherExtension;
};

export type TryRegisterResult =
  | {
      ok: true;
      /**
       * The channel's post-registration state. Callers MUST read
       * voucher-related fields from this object, not from a fresh
       * `sessionStore.get()` — those reads would fall outside the
       * per-channel lock and could reflect a concurrent writer.
       */
      state: SessionState;
    }
  | {
      ok: false;
      reason: VoucherRegistrationReason;
    };

export type CreateMPPSolanaSessionHandlerArgs = {
  network: string | SolanaCAIP2Network;
  rpc: Rpc<SolanaRpcApi>;
  facilitatorSigner: TransactionSigner;
  /**
   * The Flex escrow program address. Spec §"Method Details /
   * channelProgram" makes this field REQUIRED; we require it on the
   * handler args rather than letting the challenge ship an empty
   * string.
   */
  programAddress: Address;
  supportedMints: Address[];
  /**
   * Decimals for the supported mint(s). Must be in the range 0–9 per
   * spec §"Method Details / decimals". The handler validates this
   * during construction and will throw on out-of-range values.
   */
  mintDecimals: number;
  /**
   * Token program for the supported mint(s). Must be either the SPL
   * Token Program or the Token-2022 Program per spec §"Method Details
   * / tokenProgram". The handler validates this during construction
   * and will throw on any other value.
   */
  tokenProgram?: Address;
  defaultSplits: { recipient: string; bps: number }[];
  realm: string;
  secretKey: Uint8Array;
  sessionStore?: SessionStore;
  refundTimeoutSlots: bigint;
  deadmanTimeoutSlots: bigint;
  minGracePeriodSlots: bigint;
  challengeExpiresSeconds: number;
  /**
   * Grace-period seconds advertised to clients via the challenge's
   * `methodDetails.gracePeriodSeconds`. Spec §"Method Details"
   * RECOMMENDS 900 seconds (15 minutes); defaults to 900.
   */
  gracePeriodSeconds?: number;
  /**
   * Sponsored fee-payer policy advertised in the challenge. When
   * true, the handler asserts on the open transaction that the fee
   * payer equals `facilitatorSigner.address` per spec §"Settlement
   * Procedure / Open" step 3. Defaults to true because the handler
   * always carries a facilitatorSigner; set false only if the payer
   * is expected to fund their own open transaction.
   */
  sponsorFees?: boolean;
  /**
   * Minimum economically useful deposit, in base units. Spec
   * §"Channel Exhaustion" SHOULDs that servers reject channel opens
   * whose deposit is too small to justify signature verification,
   * storage, and settlement overhead. When set, the handler rejects
   * open transactions whose decoded `depositAmount` is below this
   * value. Defaults to undefined (no minimum).
   */
  minDepositAmount?: bigint;
  /** Tolerated clock skew (seconds) for `voucher.expiresAt` checks. */
  clockSkewSeconds?: number;
  maxRetries: number;
  retryDelayMs: number;
  flushIntervalMs: number;
};

/**
 * Result of building a Problem Details response. The `headers`
 * include `Content-Type: application/problem+json` and a fresh
 * `WWW-Authenticate: Payment ...` challenge as required by the spec
 * §"Error Responses" — every error response MUST include a fresh
 * challenge.
 */
export type ProblemResponse = {
  status: 402;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

export type FlexSessionHandler = MPPMethodHandler & {
  getSessionState(channelId: Address): Promise<SessionState | undefined>;
  remainingHold(channelId: Address): Promise<bigint>;
  tryRegisterVoucher(args: VoucherRegistration): Promise<TryRegisterResult>;
  chargeSession(channelId: Address, amount: bigint): Promise<void>;
  buildReceipt(channelId: Address): Promise<mppReceipt>;
  buildInsufficientHoldProblem(
    state: SessionState,
    requiredTopUp: bigint,
  ): verificationFailedProblem;
  buildPendingLimitProblem(state: SessionState): flexPendingLimitProblem;
  buildSessionNotFoundProblem(
    channelId: Address,
    detail?: string,
  ): verificationFailedProblem;
  /**
   * Bundles a Problem Details body with a fresh `WWW-Authenticate`
   * Payment challenge minted from the supplied pricing/resource. Use
   * this from the protected-resource body callback to satisfy the
   * spec MUST that every 402 carries a re-challenge.
   */
  formatProblemResponse(
    problem:
      | verificationFailedProblem
      | flexPendingLimitProblem
      | Record<string, unknown>,
    pricing: ResourcePricing,
    resourceURL: string,
  ): Promise<ProblemResponse>;
  /**
   * Wraps an action that mutates session state behind a per-channel
   * mutex so concurrent voucher submissions or charges on the same
   * `channelId` are serialized. Required by the spec §"Concurrency
   * and Idempotency".
   */
  withChannelLock<T>(channelId: Address, fn: () => Promise<T>): Promise<T>;
  /**
   * Idempotency-Key cache lookup. The body callback hands over the
   * client's `Idempotency-Key` header (and the challenge id from the
   * credential) and gets back either the previously cached receipt or
   * a sentinel telling it to run the work and call `recordIdempotent`.
   */
  lookupIdempotent(
    challengeId: string,
    idempotencyKey: string,
  ): Promise<mppReceipt | undefined>;
  recordIdempotent(
    challengeId: string,
    idempotencyKey: string,
    receipt: mppReceipt,
  ): Promise<void>;
  stop(): void;
};

export async function createMPPSolanaSessionHandler(
  args: CreateMPPSolanaSessionHandlerArgs,
): Promise<FlexSessionHandler> {
  const {
    network,
    realm,
    secretKey,
    supportedMints,
    defaultSplits,
    refundTimeoutSlots,
    deadmanTimeoutSlots,
    minGracePeriodSlots,
    challengeExpiresSeconds,
    facilitatorSigner,
    programAddress,
  } = args;
  const clockSkewSeconds = args.clockSkewSeconds ?? 30;
  const gracePeriodSeconds = args.gracePeriodSeconds ?? 900;
  const sponsorFees = args.sponsorFees ?? true;
  const minDepositAmount = args.minDepositAmount;

  // Spec §"Method Details / decimals": 0–9. Validate at construction
  // so a misconfiguration is surfaced before any challenge is minted.
  if (
    !Number.isInteger(args.mintDecimals) ||
    args.mintDecimals < 0 ||
    args.mintDecimals > 9
  ) {
    throw new Error(
      `session handler: mintDecimals must be an integer in 0..9, got ${args.mintDecimals}`,
    );
  }

  // Spec §"Method Details / tokenProgram": MUST be SPL Token or
  // Token-2022 when present. Validate at construction.
  if (
    args.tokenProgram !== undefined &&
    args.tokenProgram !== TOKEN_PROGRAM_ADDRESS &&
    args.tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS
  ) {
    throw new Error(
      `session handler: tokenProgram must be SPL Token or Token-2022, got ${args.tokenProgram.toString()}`,
    );
  }

  // Spec §"Request Schema / Shared Fields": native SOL is not
  // supported; clients MUST wrap to wSOL. Reject the System Program
  // address (the null mint) before it can ship in a challenge.
  const SYSTEM_PROGRAM_ADDRESS_STR = "11111111111111111111111111111111";
  for (const m of supportedMints) {
    if (m.toString() === SYSTEM_PROGRAM_ADDRESS_STR) {
      throw new Error(
        "session handler: native SOL is not supported; wrap to wSOL (So11111111111111111111111111111111111111112) before opening a channel",
      );
    }
  }

  const sessionStore = args.sessionStore ?? createInMemorySessionStore();
  const solanaNetwork = lookupX402Network(network);

  // Spec §"Method Details" allows only "mainnet-beta", "devnet", or
  // "localnet". `caip2ToCluster` returns "mainnet-beta", "devnet",
  // "testnet", or null; the spec doesn't admit testnet, so map it
  // through and let undefined drop the field.
  const caip2ToSpecNetwork = (
    caip2: string,
  ): "mainnet-beta" | "devnet" | "localnet" | undefined => {
    const cluster = caip2ToCluster(caip2);
    if (cluster === "mainnet-beta" || cluster === "devnet") {
      return cluster;
    }
    return undefined;
  };

  if (supportedMints.length === 0) {
    throw new Error("session handler requires at least one supported mint");
  }

  const getChallenge = async (
    intent: string,
    pricing: ResourcePricing,
    _resourceURL: string,
    _opts?: ChallengeOpts,
  ): Promise<mppChallengeParams> => {
    if (intent !== SESSION_INTENT) {
      throw new Error(`session handler received unexpected intent ${intent}`);
    }

    const mintAddress = pricing.asset;
    if (mintAddress === SYSTEM_PROGRAM_ADDRESS_STR) {
      // Defence in depth: even if someone passes pricing with the
      // System Program as the asset, refuse to issue the challenge.
      throw new Error(
        "session handler: native SOL is not supported; wrap to wSOL before opening a channel",
      );
    }
    const network = caip2ToSpecNetwork(solanaNetwork.caip2);
    const methodDetails: solanaSessionMethodDetails = {
      ...(network !== undefined ? { network } : {}),
      channelProgram: programAddress.toString(),
      decimals: args.mintDecimals,
      ...(args.tokenProgram !== undefined
        ? { tokenProgram: args.tokenProgram.toString() }
        : {}),
      // Spec §"Method Details": gracePeriodSeconds is RECOMMENDED;
      // feePayer/feePayerKey describe the sponsored-fees policy a
      // spec-conforming client MUST cross-check at open construction
      // time (§"Settlement Procedure / Open" step 3).
      gracePeriodSeconds,
      ...(sponsorFees
        ? {
            feePayer: true,
            feePayerKey: facilitatorSigner.address.toString(),
          }
        : {}),
      flex: {
        facilitator: facilitatorSigner.address.toString(),
        splits: defaultSplits,
        refundTimeoutSlots: refundTimeoutSlots.toString(),
        deadmanTimeoutSlots: deadmanTimeoutSlots.toString(),
        minGracePeriodSlots: minGracePeriodSlots.toString(),
      },
    };

    const requestBody = {
      amount: pricing.amount,
      currency: mintAddress,
      recipient: pricing.recipient,
      methodDetails,
    };

    const requestEncoded = encodeBase64URL(canonicalizeSortedJSON(requestBody));
    const expiresAt = Date.now() + challengeExpiresSeconds * 1000;

    const paramsWithoutID: Omit<mppChallengeParams, "id"> = {
      realm,
      method: "solana",
      intent: SESSION_INTENT,
      request: requestEncoded,
      expires: String(Math.floor(expiresAt / 1000)),
    };

    const id = await generateChallengeID(secretKey, paramsWithoutID);
    return { id, ...paramsWithoutID };
  };

  const handleSettle = async (
    credential: mppCredential,
  ): Promise<mppReceipt | null> => {
    const { challenge, payload } = credential;

    // Return null ONLY when the credential isn't for this handler's
    // method/intent. Any failure past this point is our responsibility
    // and must throw so the middleware can render a Problem Details
    // response.
    if (challenge.method !== "solana") return null;
    if (challenge.intent !== SESSION_INTENT) return null;

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch (cause) {
      throw new Error(
        `handleSettle: challenge.request is not valid base64url JSON`,
        { cause },
      );
    }
    const request = solanaSessionRequest(requestBody);
    if (isValidationError(request)) {
      throw new Error(
        `handleSettle: challenge.request does not match solanaSessionRequest: ${request.summary}`,
      );
    }

    const idValid = await verifyChallengeID(secretKey, challenge);
    if (!idValid) {
      throw new Error("invalid challenge ID");
    }

    if (challenge.expires !== undefined) {
      const expiresSeconds = Number(challenge.expires);
      if (!Number.isFinite(expiresSeconds) || expiresSeconds <= 0) {
        throw new Error(
          `handleSettle: challenge.expires is not a positive number: ${challenge.expires}`,
        );
      }
      const expiresAtMs = expiresSeconds * 1000;
      if (Date.now() > expiresAtMs) {
        throw new Error("challenge expired");
      }
    }

    const validatedPayload = solanaSessionPayload(payload);
    if (isValidationError(validatedPayload)) {
      throw new Error(
        `invalid credential payload: ${validatedPayload.summary}`,
      );
    }

    const buildReceiptFromState = (state: SessionState): mppReceipt => ({
      status: "success",
      method: "solana",
      intent: SESSION_INTENT,
      timestamp: new Date().toISOString(),
      reference: validatedPayload.channelId,
      challengeId: challenge.id,
      acceptedCumulative: state.acceptedCumulative.toString(),
      spent: state.spent.toString(),
    });

    if (validatedPayload.action === "voucher") {
      // Spec §"Voucher Verification" steps 1, 2, 4 (signature,
      // canonicalization, channelId match) and step 9 (expiresAt
      // tolerance) are enforced here against the raw voucher bytes
      // before any state inspection.
      await verifyVoucher(validatedPayload.voucher, {
        channelId: validatedPayload.channelId,
      });

      // The Flex authorization extension is required for on-chain
      // Flex settlement. Verify it here when present; its absence is
      // spec-conforming (Flex is a Faremeter extension) but will
      // prevent on-chain settlement of this voucher.
      if (validatedPayload.flex !== undefined) {
        await verifyFlexAuthorization(
          validatedPayload.voucher,
          validatedPayload.flex,
          {
            channelId: validatedPayload.channelId,
            programAddress,
          },
        );
        // Flex-specific cross-check: the signed authorization splits
        // must match the challenge's `defaultSplits`.
        assertSplitsMatch(defaultSplits, validatedPayload.flex.splits);
      }

      // Spec §"Voucher Verification" steps 3 (signer matches
      // authorized signer), 6 & 7 (channel discriminator / status),
      // 5 (monotonicity and idempotent replay), 8 (cumulative does
      // not exceed escrow), and 10 (persist before serving) all live
      // inside `tryRegisterVoucher`.
      const channelIdAddress = address(validatedPayload.channelId);
      const registration: VoucherRegistration = {
        channelId: channelIdAddress,
        sessionKey: address(validatedPayload.voucher.signer),
        voucher: validatedPayload.voucher,
        ...(validatedPayload.flex !== undefined
          ? { flex: validatedPayload.flex }
          : {}),
      };
      const result = await tryRegisterVoucher(registration);
      if (!result.ok) {
        throw new VoucherRegistrationError(result.reason);
      }
      // Build the receipt from the post-register state returned by
      // tryRegisterVoucher. A separate `sessionStore.get()` would run
      // outside the per-channel lock and could reflect a concurrent
      // voucher's state.
      return buildReceiptFromState(result.state);
    }

    if (validatedPayload.action === "open") {
      // The initial signed voucher is REQUIRED by spec §"Action: open".
      // Verify its signature; we'll use voucher.signer as the session
      // key for state lookup.
      await verifyVoucher(validatedPayload.voucher, {
        channelId: validatedPayload.channelId,
      });
      const sessionKey = address(validatedPayload.voucher.signer);
      const verified = await verifyFlexOpenTransaction({
        transaction: validatedPayload.transaction,
        expectedChannelId: address(validatedPayload.channelId),
        expectedSessionKey: sessionKey,
        programAddress,
        expectedFacilitator: facilitatorSigner.address,
        expectedRefundTimeoutSlots: refundTimeoutSlots,
        expectedDeadmanTimeoutSlots: deadmanTimeoutSlots,
        // Sponsored-fees branch: fee payer must equal the declared
        // facilitatorKey. Non-sponsored branch: fee payer must equal
        // the credential's payer. Both are spec §"Settlement
        // Procedure / Open" step 3.
        ...(sponsorFees
          ? { expectedFeePayer: facilitatorSigner.address }
          : { expectedPayer: address(validatedPayload.payer) }),
      });

      // Spec §"Settlement Procedure / Open" step 6: "token/asset
      // matches the challenge currency". Cross-check the deposit
      // instruction's mint against the challenge's parsed currency.
      if (verified.decoded.mint.toString() !== request.currency) {
        throw new Error(
          `open transaction deposits mint ${verified.decoded.mint} but the challenge requested currency ${request.currency}`,
        );
      }

      // Spec §"Channel Exhaustion": SHOULD reject opens below a
      // minimum economically useful deposit to avoid channel spam.
      if (
        minDepositAmount !== undefined &&
        verified.decoded.depositAmount < minDepositAmount
      ) {
        throw new Error(
          `open transaction depositAmount ${verified.decoded.depositAmount} is below minDepositAmount ${minDepositAmount}`,
        );
      }

      // Persist the session state derived from the open transaction.
      // The initial voucher's cumulativeAmount becomes the channel's
      // initial accepted cumulative (typically 0). The mint is read
      // from the deposit instruction the client included in the open
      // batch.
      const channelIdAddress = address(validatedPayload.channelId);
      const persistedState = await withChannelLock(
        channelIdAddress,
        async (): Promise<SessionState> => {
          const existing = await sessionStore.get(channelIdAddress);
          if (existing) {
            // Idempotent re-open. The spec §"Action: open" allows
            // re-issuing an open with the same channelId; we don't
            // overwrite live session state.
            return existing;
          }
          const initialCumulative = BigInt(
            validatedPayload.voucher.voucher.cumulativeAmount,
          );
          const fresh: SessionState = {
            channelId: channelIdAddress,
            sessionKey,
            mint: verified.decoded.mint,
            escrowedAmount: verified.decoded.depositAmount,
            acceptedCumulative: initialCumulative,
            spent: 0n,
            inFlightAuthorizationIds: [],
            status: "open",
          };
          await sessionStore.put(fresh);
          return fresh;
        },
      );
      return buildReceiptFromState(persistedState);
    }

    if (validatedPayload.action === "close") {
      // Spec §"Action: close": the credential MAY carry a final
      // voucher. If present, verify it via the same voucher-verification
      // steps before relying on its cumulative amount.
      const channelIdAddress = address(validatedPayload.channelId);
      if (validatedPayload.voucher !== undefined) {
        await verifyVoucher(validatedPayload.voucher, {
          channelId: validatedPayload.channelId,
        });
        const registration: VoucherRegistration = {
          channelId: channelIdAddress,
          sessionKey: address(validatedPayload.voucher.signer),
          voucher: validatedPayload.voucher,
        };
        const result = await tryRegisterVoucher(registration);
        if (!result.ok) {
          throw new VoucherRegistrationError(result.reason);
        }
      }
      // Transition status to "closing". On Flex this is the only
      // close signal the off-chain handler can express; the actual
      // on-chain close happens via Flex's finalize/refund/force_close
      // paths per COMPATIBILITY.md "No closeRequestedAt /
      // ClosedChannel discriminator".
      const closedState = await withChannelLock(
        channelIdAddress,
        async (): Promise<SessionState> => {
          const existing = await sessionStore.get(channelIdAddress);
          if (!existing) {
            throw new Error(
              `close: no session state for channelId ${validatedPayload.channelId}`,
            );
          }
          if (existing.status !== "open") {
            throw new Error(
              `close: channel ${validatedPayload.channelId} is not open (status=${existing.status})`,
            );
          }
          const updated: SessionState = { ...existing, status: "closing" };
          await sessionStore.put(updated);
          return updated;
        },
      );
      return buildReceiptFromState(closedState);
    }

    if (validatedPayload.action === "topUp") {
      // topUp verification is not yet implemented. The spec's topUp
      // path requires decoding the additional-deposit transaction,
      // verifying it targets the existing escrow, and bumping
      // `escrowedAmount` — none of which we do off-chain today. Per
      // COMPATIBILITY.md "Deferred — topUp / close settlement paths",
      // the handler currently REJECTS topUp credentials instead of
      // silently returning a success receipt so spec-conforming
      // clients don't believe a top-up went through when it didn't.
      throw new Error(
        "topUp action is not implemented on this handler; see COMPATIBILITY.md",
      );
    }

    // All action discriminators are covered above; this is
    // unreachable given arktype validation.
    throw new Error(
      `handleSettle: unhandled action ${(validatedPayload as { action: string }).action}`,
    );
  };

  /**
   * Verifies a spec-shaped signed voucher: JCS canonicalization,
   * base58 Ed25519 signature, signer matches voucher.signer, and the
   * channelId in the voucher data matches the credential's channelId.
   * Also enforces `expiresAt` if present (with the configured clock
   * skew tolerance).
   */
  const verifyVoucher = async (
    voucher: solanaSignedVoucher,
    ctx: { channelId: string },
  ): Promise<void> => {
    if (voucher.signatureType !== "ed25519") {
      throw new Error(
        `unsupported voucher signatureType: ${voucher.signatureType}`,
      );
    }
    if (voucher.voucher.channelId !== ctx.channelId) {
      throw new Error("voucher.channelId does not match credential channelId");
    }
    if (voucher.voucher.expiresAt !== undefined) {
      const expiresAtMs = Date.parse(voucher.voucher.expiresAt);
      if (Number.isNaN(expiresAtMs)) {
        throw new Error(
          `voucher.expiresAt is not a valid ISO 8601 timestamp: ${voucher.voucher.expiresAt}`,
        );
      }
      const skewMs = clockSkewSeconds * 1000;
      if (Date.now() - skewMs > expiresAtMs) {
        throw new Error("voucher has expired");
      }
    }

    const specMessage = serializeSpecVoucherMessage({
      channelId: voucher.voucher.channelId,
      cumulativeAmount: voucher.voucher.cumulativeAmount,
      ...(voucher.voucher.expiresAt !== undefined
        ? { expiresAt: voucher.voucher.expiresAt }
        : {}),
    });
    const signerBytes = addressToBytes(address(voucher.signer));
    const specSig = bs58.decode(voucher.signature);
    const specOk = await verifyVoucherSignature({
      publicKey: signerBytes,
      message: specMessage,
      signature: specSig,
    });
    if (!specOk) {
      throw new Error("spec voucher signature verification failed");
    }
  };

  /**
   * Verifies the Flex authorization extension signature: packed
   * binary over the on-chain authorization layout, base64, signed by
   * the same session key. This is the signature `submit_authorization`
   * will verify on chain via the Ed25519 precompile.
   */
  const verifyFlexAuthorization = async (
    voucher: solanaSignedVoucher,
    flex: flexVoucherExtension,
    ctx: { channelId: string; programAddress: Address },
  ): Promise<void> => {
    const flexMessage = serializeVoucherMessage({
      programAddress: ctx.programAddress,
      escrow: address(ctx.channelId),
      mint: address(flex.mint),
      maxAmount: BigInt(flex.maxAmount),
      authorizationId: BigInt(flex.authorizationId),
      expiresAtSlot: BigInt(flex.expiresAtSlot),
      splits: flex.splits.map((s) => ({
        recipient: address(s.recipient),
        bps: s.bps,
      })),
    });
    const signerBytes = addressToBytes(address(voucher.signer));
    const flexSig = base64ToBytes(flex.signature);
    const flexOk = await verifyVoucherSignature({
      publicKey: signerBytes,
      message: flexMessage,
      signature: flexSig,
    });
    if (!flexOk) {
      throw new Error("flex voucher signature verification failed");
    }
  };

  const getSessionState = async (
    channelId: Address,
  ): Promise<SessionState | undefined> => {
    return sessionStore.get(channelId);
  };

  const remainingHold = async (channelId: Address): Promise<bigint> => {
    const state = await sessionStore.get(channelId);
    if (!state) {
      throw new Error(`remainingHold: no session for ${channelId.toString()}`);
    }
    return state.acceptedCumulative - state.spent;
  };

  // Per-channel mutex map. Required by spec §"Concurrency and
  // Idempotency": voucher acceptance and debit processing MUST be
  // serialized per `channelId`.
  const channelLocks = new Map<string, Promise<unknown>>();
  const withChannelLock = async <T>(
    channelId: Address,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const key = channelId.toString();
    const previous = channelLocks.get(key) ?? Promise.resolve();
    let resolveNext!: () => void;
    const next = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    const ours = previous.then(() => next);
    channelLocks.set(key, ours);
    try {
      await previous;
      return await fn();
    } finally {
      resolveNext();
      if (channelLocks.get(key) === ours) {
        channelLocks.delete(key);
      }
    }
  };

  const tryRegisterVoucher = async (
    registration: VoucherRegistration,
  ): Promise<TryRegisterResult> =>
    withChannelLock(registration.channelId, async () => {
      const state = await sessionStore.get(registration.channelId);
      if (!state) {
        // Spec §"Voucher Verification" step 1: channel must exist.
        return { ok: false, reason: "session-not-found" };
      }
      if (state.status !== "open") {
        // Spec §"Voucher Verification" steps 6 & 7: channel must not
        // be finalized (ClosedChannel discriminator) or in a
        // closeRequestedAt-pending state. Flex has no on-chain
        // equivalent of these fields; we approximate with the
        // off-chain SessionStatus — see COMPATIBILITY.md "No
        // closeRequestedAt / ClosedChannel discriminator".
        return { ok: false, reason: "channel-closed" };
      }
      if (state.sessionKey !== address(registration.voucher.signer)) {
        // Spec §"Voucher Verification" step 3: signer must match the
        // channel's authorized signer. Caller is responsible for
        // having verified the Ed25519 signature itself before
        // reaching this point.
        return { ok: false, reason: "signer-mismatch" };
      }
      const incomingCumulative = BigInt(
        registration.voucher.voucher.cumulativeAmount,
      );
      if (incomingCumulative === state.acceptedCumulative) {
        // Spec §"Concurrency and Idempotency": equal cumulative is an
        // idempotent resubmission. Return success with the current
        // state, without mutating.
        return { ok: true, state };
      }
      if (incomingCumulative < state.acceptedCumulative) {
        // Spec §"Concurrency and Idempotency": lower cumulative is a
        // replay; return the current receipt state without reducing
        // channel state.
        logger.warning("voucher cumulativeAmount is below current accepted", {
          incoming: incomingCumulative.toString(),
          current: state.acceptedCumulative.toString(),
        });
        return { ok: true, state };
      }
      if (incomingCumulative > state.escrowedAmount) {
        // Spec §"Voucher Verification" step 8: cumulativeAmount must
        // not exceed the escrow's deposited balance.
        return { ok: false, reason: "insufficient-hold" };
      }
      if (state.inFlightAuthorizationIds.length >= PENDING_LIMIT_MAX) {
        // Flex-specific back-pressure (not in the spec); see
        // COMPATIBILITY.md "MAX_PENDING = 16 ceiling".
        return { ok: false, reason: "pending-limit" };
      }
      const inFlight =
        registration.flex !== undefined
          ? [
              ...state.inFlightAuthorizationIds,
              BigInt(registration.flex.authorizationId),
            ]
          : state.inFlightAuthorizationIds;
      const updated: SessionState = {
        ...state,
        acceptedCumulative: incomingCumulative,
        inFlightAuthorizationIds: inFlight,
      };
      // Spec §"Voucher Verification" step 10: persist the new
      // acceptedCumulative BEFORE serving the resource. The caller
      // receives the post-registration state so its receipt reflects
      // the voucher *this* call accepted, even if a later voucher
      // advances state between here and the caller's receipt build.
      await sessionStore.put(updated);
      return { ok: true, state: updated };
    });

  const chargeSession = async (
    channelId: Address,
    amount: bigint,
  ): Promise<void> =>
    withChannelLock(channelId, async () => {
      const state = await sessionStore.get(channelId);
      if (!state) {
        throw new Error(
          `chargeSession: no session for ${channelId.toString()}`,
        );
      }
      const newSpent = state.spent + amount;
      if (newSpent > state.acceptedCumulative) {
        throw new Error(
          `chargeSession: spent ${newSpent} exceeds acceptedCumulative ${state.acceptedCumulative}`,
        );
      }
      await sessionStore.put({ ...state, spent: newSpent });
    });

  const buildReceipt = async (channelId: Address): Promise<mppReceipt> => {
    const state = await sessionStore.get(channelId);
    if (!state) {
      // The caller only invokes buildReceipt when they believe a
      // session exists. A missing state here is a programming error;
      // per CLAUDE.md we surface it rather than paper over with a
      // default "0" receipt.
      throw new Error(
        `buildReceipt: no session state for channelId ${channelId.toString()}`,
      );
    }
    return {
      status: "success",
      method: "solana",
      intent: SESSION_INTENT,
      timestamp: new Date().toISOString(),
      reference: channelId.toString(),
      acceptedCumulative: state.acceptedCumulative.toString(),
      spent: state.spent.toString(),
    };
  };

  const formatProblemResponse = async (
    problem:
      | verificationFailedProblem
      | flexPendingLimitProblem
      | Record<string, unknown>,
    pricing: ResourcePricing,
    resourceURL: string,
  ): Promise<ProblemResponse> => {
    const challenge = await getChallenge(SESSION_INTENT, pricing, resourceURL);
    return {
      status: 402,
      body: problem as Record<string, unknown>,
      headers: {
        "Content-Type": "application/problem+json",
        "WWW-Authenticate": formatWWWAuthenticate([challenge]),
      },
    };
  };

  // Idempotency cache for `(challengeId, idempotencyKey)`. Required by
  // spec §"Concurrency and Idempotency": servers MUST NOT increment
  // `spentAmount` twice for a duplicate idempotent request. Entries
  // are evicted on insert once the map reaches `IDEMPOTENCY_CACHE_MAX`
  // (FIFO eviction via insertion order). This is a bounded in-memory
  // cache so a long-running facilitator doesn't leak memory across
  // an unbounded stream of unique (challengeId, idempotencyKey) pairs.
  const IDEMPOTENCY_CACHE_MAX = 4096;
  const idempotencyCache = new Map<string, mppReceipt>();
  const idemKey = (challengeId: string, key: string) => `${challengeId}:${key}`;
  const lookupIdempotent = async (
    challengeId: string,
    key: string,
  ): Promise<mppReceipt | undefined> => {
    return idempotencyCache.get(idemKey(challengeId, key));
  };
  const recordIdempotent = async (
    challengeId: string,
    key: string,
    receipt: mppReceipt,
  ): Promise<void> => {
    const k = idemKey(challengeId, key);
    // If the key already exists, delete-then-set refreshes its
    // insertion-order position (LRU-on-write).
    if (idempotencyCache.has(k)) {
      idempotencyCache.delete(k);
    } else if (idempotencyCache.size >= IDEMPOTENCY_CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = idempotencyCache.keys().next().value;
      if (oldest !== undefined) {
        idempotencyCache.delete(oldest);
      }
    }
    idempotencyCache.set(k, receipt);
  };

  return {
    method: "solana",
    capabilities: {
      networks: [solanaNetwork.caip2],
      assets: supportedMints.map((m) => m.toString()),
    },
    getSupportedIntents: () => [SESSION_INTENT],
    getChallenge,
    handleSettle,
    getSessionState,
    remainingHold,
    tryRegisterVoucher,
    chargeSession,
    buildReceipt,
    buildInsufficientHoldProblem,
    buildPendingLimitProblem,
    buildSessionNotFoundProblem: (channelId, detail) =>
      buildSessionNotFoundProblem(channelId.toString(), detail),
    formatProblemResponse,
    withChannelLock,
    lookupIdempotent,
    recordIdempotent,
    stop: () => undefined,
  };
}
