import type {
  MPPPaymentHandler,
  MPPPaymentExecer,
  mppChallengeParams,
  mppCredential,
} from "@faremeter/types/mpp";
import {
  decodeBase64URL,
  SESSION_INTENT,
  serializeCredential,
} from "@faremeter/types/mpp";
import { isValidationError } from "@faremeter/types";
import { address, type Address } from "@solana/kit";
import type { webcrypto } from "node:crypto";

type SessionKeyPair = webcrypto.CryptoKeyPair;

import bs58 from "bs58";
import { solanaSessionRequest } from "./common";
import { serializeSpecVoucherMessage, serializeVoucherMessage } from "./verify";
import { type flexPendingLimitProblem } from "./problem";
import { logger } from "./logger";

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

type ClientSessionState = {
  challenge: mppChallengeParams;
  escrow: Address;
  sessionKey: Address;
  mint: Address;
  acceptedCumulative: bigint;
  /**
   * Splits the server expects on every Flex authorization. Read from
   * the challenge's `methodDetails.flex.splits` at open time and
   * applied to every voucher this client builds for this channel —
   * the handler cross-checks the client's splits against its own
   * `defaultSplits`, and any mismatch is rejected.
   */
  splits: { recipient: string; bps: number }[];
};

export type SessionClientWallet = {
  address: Address;
};

export type CreateMPPSolanaSessionClientArgs = {
  wallet: SessionClientWallet;
  sessionKeyPair: SessionKeyPair;
  sessionKeyAddress: Address;
  programAddress: Address;
  /**
   * Builds the initial session open transaction. Returns the base64
   * wire transaction plus the escrow address the server should see,
   * the mint, the payer pubkey, and the deposit amount the open
   * transaction encodes. The payer and depositAmount are spec-required
   * fields on the open credential per draft-solana-session-00 §"Action:
   * open".
   */
  buildOpenTransaction: (args: {
    challenge: mppChallengeParams;
    request: solanaSessionRequest;
    sessionKey: Address;
  }) => Promise<{
    transaction: string;
    escrow: Address;
    mint: Address;
    payer: Address;
    depositAmount: bigint;
  }>;
  /**
   * TTL (seconds) applied to the `expiresAt` field on every signed
   * voucher the client produces. draft-solana-session-00 §"Delegated
   * Signer Risks" MUSTs that delegated keys be treated as short-lived
   * single-session credentials — a finite TTL bounds exposure if the
   * session key is compromised. Recommended: on the order of minutes.
   * Defaults to 300s (5 minutes).
   */
  voucherTTLSeconds?: number;
};

export type MPPSolanaSessionClient = MPPPaymentHandler & {
  /**
   * Handles a `verification-failed` Problem Details response that the
   * server emitted because the session's accepted cumulative would
   * exceed the deposit. Returns a fresh `Authorization: Payment ...`
   * header value carrying a new voucher with the additional delta the
   * caller specifies.
   */
  handleInsufficientHold(args: {
    channelId: string;
    requiredTopUp: bigint;
  }): Promise<string>;
  /**
   * Handles a Faremeter `flex-pending-limit` Problem Details response.
   * Returns a fresh Authorization header after polling for the pending
   * count to drop. The caller chooses the back-off policy.
   */
  handlePendingLimit(problem: flexPendingLimitProblem): Promise<string>;
  /**
   * Handles a `verification-failed` Problem Details response that the
   * server emitted because the channel is not present in its session
   * store. Throws SessionExpiredError so the application can re-open.
   */
  handleSessionNotFound(channelId: string): never;
  readonly sessions: ReadonlyMap<string, ClientSessionState>;
};

function sessionKey(escrow: Address, sessionKeyAddress: Address): string {
  return `${escrow.toString()}:${sessionKeyAddress.toString()}`;
}

export function createMPPSolanaSessionClient(
  args: CreateMPPSolanaSessionClientArgs,
): MPPSolanaSessionClient {
  const sessions = new Map<string, ClientSessionState>();
  const voucherTTLSeconds = args.voucherTTLSeconds ?? 300;
  const nowISOPlusTTL = (): string =>
    new Date(Date.now() + voucherTTLSeconds * 1000).toISOString();

  const handler: MPPPaymentHandler = async (
    challenge: mppChallengeParams,
  ): Promise<MPPPaymentExecer | null> => {
    if (challenge.method !== "solana") return null;
    if (challenge.intent !== SESSION_INTENT) return null;

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }
    const request = solanaSessionRequest(requestBody);
    if (isValidationError(request)) return null;

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const built = await args.buildOpenTransaction({
          challenge,
          request,
          sessionKey: args.sessionKeyAddress,
        });
        const state: ClientSessionState = {
          challenge,
          escrow: built.escrow,
          sessionKey: args.sessionKeyAddress,
          mint: built.mint,
          acceptedCumulative: 0n,
          splits: request.methodDetails.flex.splits,
        };
        sessions.set(sessionKey(built.escrow, args.sessionKeyAddress), state);

        // draft-solana-session-00 §"Action: open" requires the open
        // credential to carry an initial signed voucher. The initial
        // voucher's cumulativeAmount is 0; the spec voucher signature
        // is computed over JCS-canonicalized voucher data and base58
        // encoded. Spec §"Delegated Signer Risks" MUSTs a finite TTL.
        const initialExpiresAt = nowISOPlusTTL();
        const initialVoucherMessage = serializeSpecVoucherMessage({
          channelId: built.escrow.toString(),
          cumulativeAmount: "0",
          expiresAt: initialExpiresAt,
        });
        const initialVoucherSig = new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            args.sessionKeyPair.privateKey,
            initialVoucherMessage,
          ),
        );

        return {
          challenge,
          payload: {
            action: "open",
            channelId: built.escrow.toString(),
            payer: built.payer.toString(),
            depositAmount: built.depositAmount.toString(),
            transaction: built.transaction,
            voucher: {
              voucher: {
                channelId: built.escrow.toString(),
                cumulativeAmount: "0",
                expiresAt: initialExpiresAt,
              },
              signer: args.sessionKeyAddress.toString(),
              signature: bs58.encode(initialVoucherSig),
              signatureType: "ed25519",
            },
          },
        };
      },
    };
  };

  const buildVoucherCredential = async (
    state: ClientSessionState,
    delta: bigint,
  ): Promise<string> => {
    const newCumulative = state.acceptedCumulative + delta;
    const authorizationId = randomU64();
    // Flex's on-chain `expiresAtSlot` is a slot number; we have no
    // Clock read from here and the server's RPC will supply one if
    // it needs to bind the authorization. For now we pass 0 (no
    // slot-level expiry); the spec voucher `expiresAt` below bounds
    // the delegated key's exposure regardless.
    const expiresAtSlot = 0n;
    const expiresAt = nowISOPlusTTL();

    // 1. Spec voucher: JCS canonicalized, base58 signature, with a
    // finite TTL per §"Delegated Signer Risks".
    const specMessage = serializeSpecVoucherMessage({
      channelId: state.escrow.toString(),
      cumulativeAmount: newCumulative.toString(),
      expiresAt,
    });
    const specSig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        args.sessionKeyPair.privateKey,
        specMessage,
      ),
    );
    const specSignature = bs58.encode(specSig);

    // 2. Flex authorization: packed binary, base64 signature. Splits
    // come from the challenge the channel was opened against, not from
    // the client — the handler cross-checks them against its
    // `defaultSplits` and rejects any mismatch.
    const flexMessage = serializeVoucherMessage({
      programAddress: args.programAddress,
      escrow: state.escrow,
      mint: state.mint,
      maxAmount: delta,
      authorizationId,
      expiresAtSlot,
      splits: state.splits.map((s) => ({
        recipient: address(s.recipient),
        bps: s.bps,
      })),
    });
    const flexSig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        args.sessionKeyPair.privateKey,
        flexMessage,
      ),
    );
    const flexSignature = bytesToBase64(flexSig);

    state.acceptedCumulative = newCumulative;

    // draft-solana-session-00 §"Action: voucher" defines exactly three
    // fields on the voucher credential payload: `action`, `channelId`,
    // and the signed `voucher`. The Flex authorization extension rides
    // alongside as a Faremeter extension under `flex`. No other
    // top-level keys belong here.
    const credential: mppCredential = {
      challenge: state.challenge,
      payload: {
        action: "voucher",
        channelId: state.escrow.toString(),
        voucher: {
          voucher: {
            channelId: state.escrow.toString(),
            cumulativeAmount: newCumulative.toString(),
            expiresAt,
          },
          signer: state.sessionKey.toString(),
          signature: specSignature,
          signatureType: "ed25519",
        },
        flex: {
          mint: state.mint.toString(),
          authorizationId: authorizationId.toString(),
          maxAmount: delta.toString(),
          expiresAtSlot: expiresAtSlot.toString(),
          splits: state.splits,
          signature: flexSignature,
        },
      },
    };
    return `Payment ${serializeCredential(credential)}`;
  };

  return Object.assign(handler, {
    sessions,
    handleInsufficientHold: async (args: {
      channelId: string;
      requiredTopUp: bigint;
    }) => {
      const state = findSession(sessions, args.channelId);
      if (!state) {
        throw new SessionExpiredError(
          `no cached session state for ${args.channelId}`,
        );
      }
      return buildVoucherCredential(state, args.requiredTopUp);
    },
    handlePendingLimit: async (problem: flexPendingLimitProblem) => {
      logger.info("pending-limit problem received, backing off", {
        channelId: problem.channelId,
        pendingCount: problem.pendingCount,
      });
      const state = findSession(sessions, problem.channelId);
      if (!state) {
        throw new SessionExpiredError(
          `no cached session state for ${problem.channelId}`,
        );
      }
      return buildVoucherCredential(state, 0n);
    },
    handleSessionNotFound: (channelId: string): never => {
      const iterKey = [...sessions.keys()].find((k) =>
        k.startsWith(`${channelId}:`),
      );
      if (iterKey) sessions.delete(iterKey);
      throw new SessionExpiredError(
        `server reported session not found for ${channelId}`,
      );
    },
  });
}

function findSession(
  sessions: Map<string, ClientSessionState>,
  channelId: string,
): ClientSessionState | undefined {
  for (const [k, v] of sessions) {
    if (k.startsWith(`${channelId}:`)) return v;
  }
  return undefined;
}

function randomU64(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let out = 0n;
  for (let i = 0; i < 8; i++) {
    out = (out << 8n) | BigInt(buf[i] ?? 0);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// `address` is imported so the public API can type-narrow user-supplied
// strings at the edges; keep it referenced even if unused by the current
// body.
void address;
