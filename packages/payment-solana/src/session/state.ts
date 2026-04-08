import type { Address } from "@solana/kit";

export type SessionStatus = "open" | "closing" | "closed";

export type SessionState = {
  channelId: Address;
  sessionKey: Address;
  mint: Address;
  /**
   * Total amount deposited into the channel (initial `depositAmount`
   * at open time plus any `topUp` amounts). The spec §"Voucher
   * Verification" step 8 requires the server to reject any voucher
   * whose `cumulativeAmount` exceeds this value.
   */
  escrowedAmount: bigint;
  acceptedCumulative: bigint;
  spent: bigint;
  inFlightAuthorizationIds: bigint[];
  status: SessionStatus;
};

/**
 * Per-channel session state. The spec model is one session per
 * channel; the channel's `authorizedSigner` is the only voucher
 * signer permitted, so the store is keyed by `channelId` alone.
 * `sessionKey` is recorded as a property of the state for callers
 * that need it.
 */
export interface SessionStore {
  get(channelId: Address): Promise<SessionState | undefined>;
  put(state: SessionState): Promise<void>;
  delete(channelId: Address): Promise<void>;
  iterate(): AsyncIterable<SessionState>;
}

export function createInMemorySessionStore(): SessionStore {
  const entries = new Map<string, SessionState>();

  const clone = (state: SessionState): SessionState => ({
    ...state,
    inFlightAuthorizationIds: [...state.inFlightAuthorizationIds],
  });

  return {
    async get(channelId) {
      const found = entries.get(channelId.toString());
      return found ? clone(found) : undefined;
    },
    async put(state) {
      entries.set(state.channelId.toString(), clone(state));
    },
    async delete(channelId) {
      entries.delete(channelId.toString());
    },
    async *iterate() {
      for (const state of entries.values()) {
        yield clone(state);
      }
    },
  };
}
