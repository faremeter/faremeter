/**
 * Shared mock factories for testing splits-solana
 */
import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";

// =============================================================================
// Constants (valid base58 addresses that decode to 32 bytes)
// =============================================================================

// Use real-looking addresses (these are deterministically derived, not real keys)
export const MOCK_AUTHORITY =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
export const MOCK_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address; // USDC
export const MOCK_SPLIT_CONFIG =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const MOCK_VAULT =
  "So11111111111111111111111111111111111111112" as Address;
export const MOCK_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
export const MOCK_BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

// =============================================================================
// Mock RPC Factory
// =============================================================================

export interface MockRpcOverrides {
  getAccountInfo?: (address: Address) => Promise<{ value: unknown }>;
  getLatestBlockhash?: () => Promise<{
    value: { blockhash: string; lastValidBlockHeight: bigint };
  }>;
  simulateTransaction?: () => Promise<{ value: { err: unknown } }>;
  sendTransaction?: () => Promise<string>;
  getSignatureStatuses?: () => Promise<{
    value: ({ confirmationStatus: string; err?: unknown } | null)[];
  }>;
  getMinimumBalanceForRentExemption?: () => Promise<bigint>;
  getTokenAccountBalance?: () => Promise<{ value: { amount: string } }>;
}

/**
 * Create a mock RPC client with sensible defaults.
 * All methods return via `.send()` pattern like real Solana kit.
 */
export function createMockRpc(
  overrides: MockRpcOverrides = {},
): Rpc<SolanaRpcApi> {
  const defaults: Required<MockRpcOverrides> = {
    getAccountInfo: async () => ({ value: null }),
    getLatestBlockhash: async () => ({
      value: { blockhash: MOCK_BLOCKHASH, lastValidBlockHeight: 1000n },
    }),
    simulateTransaction: async () => ({ value: { err: null } }),
    sendTransaction: async () => MOCK_SIGNATURE,
    getSignatureStatuses: async () => ({
      value: [{ confirmationStatus: "confirmed" }],
    }),
    getMinimumBalanceForRentExemption: async () => 1_000_000n,
    getTokenAccountBalance: async () => ({ value: { amount: "0" } }),
  };

  const merged = { ...defaults, ...overrides };

  // Wrap each method in the `.send()` pattern
  const rpc = {
    getAccountInfo: (address: Address) => ({
      send: () => merged.getAccountInfo(address),
    }),
    getLatestBlockhash: () => ({
      send: merged.getLatestBlockhash,
    }),
    simulateTransaction: () => ({
      send: merged.simulateTransaction,
    }),
    sendTransaction: () => ({
      send: merged.sendTransaction,
    }),
    getSignatureStatuses: () => ({
      send: merged.getSignatureStatuses,
    }),
    getMinimumBalanceForRentExemption: () => ({
      send: merged.getMinimumBalanceForRentExemption,
    }),
    getTokenAccountBalance: () => ({
      send: merged.getTokenAccountBalance,
    }),
  };

  return rpc as unknown as Rpc<SolanaRpcApi>;
}

// =============================================================================
// Mock Signer Factory
// =============================================================================

/**
 * Create a mock transaction signer.
 */
export function createMockSigner(
  address: Address = MOCK_AUTHORITY,
): TransactionSigner {
  return {
    address,
    signMessages: async <T extends readonly Uint8Array[]>(messages: T) =>
      messages.map(() => ({
        signature: new Uint8Array(64).fill(1) as Uint8Array & {
          readonly __brand: unique symbol;
        },
        address,
      })) as { [K in keyof T]: { signature: Uint8Array; address: Address } },
    signTransactions: async <T extends readonly unknown[]>(transactions: T) =>
      transactions,
  } as unknown as TransactionSigner;
}

// =============================================================================
// Mock Split Config Data
// =============================================================================

export interface MockSplitConfigData {
  authority: Address;
  mint: Address;
  recipients: { address: Address; percentageBps: number }[];
  unclaimedAmounts: { address: Address; amount: bigint }[];
  protocolUnclaimed: bigint;
}

export function createMockSplitConfig(
  overrides: Partial<MockSplitConfigData> = {},
): MockSplitConfigData {
  return {
    authority: MOCK_AUTHORITY,
    mint: MOCK_MINT,
    recipients: [
      {
        address: "Recipient1111111111111111111111111111111111" as Address,
        percentageBps: 4950,
      },
      {
        address: "Recipient2222222222222222222222222222222222" as Address,
        percentageBps: 4950,
      },
    ],
    unclaimedAmounts: [],
    protocolUnclaimed: 0n,
    ...overrides,
  };
}
