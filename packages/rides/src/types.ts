import { type PaymentHandler } from "@faremeter/types/client";

/** List of blockchain networks supported by the payer. */
export const KnownNetworks = [
  "base",
  "base-sepolia",
  "monad",
  "monad-testnet",
  "polygon",
  "polygon-amoy",
  "solana",
  "solana-devnet",
] as const;

/** A blockchain network supported by the payer. */
export type KnownNetwork = (typeof KnownNetworks)[number];

/** List of token assets supported by the payer. */
export const KnownAssets = ["USDC"] as const;

/** A token asset supported by the payer. */
export type KnownAsset = (typeof KnownAssets)[number];

/** Token balance information from a wallet. */
export type Balance = {
  /** Human-readable name of the token. */
  name: string;
  /** Balance amount in the token's smallest unit. */
  amount: bigint;
  /** Number of decimal places for the token. */
  decimals: number;
};

/** Function that retrieves the current balance from a wallet. */
export type GetBalance = () => Promise<Balance>;

/** Identifies a payment capability by scheme, network, and asset. */
export type PaymentIdV2 = {
  scheme: string;
  network: string;
  asset: string;
};

/**
 * Adapter that connects a wallet to the payer system.
 * Provides payment handling and balance checking capabilities.
 */
export interface WalletAdapter {
  /** Payment identifiers this wallet can handle. */
  x402Id: PaymentIdV2[];
  /** Handler for executing payments. */
  paymentHandler: PaymentHandler;
  /** Function to retrieve current balance. */
  getBalance: GetBalance;
}

/**
 * Adapter for a payment network that can load local wallets.
 */
export interface PayerAdapter {
  /**
   * Attempts to create wallet adapters from the provided input.
   *
   * @param input - Wallet configuration (format depends on the network)
   * @returns Array of wallet adapters if successful, null if input is not compatible
   */
  addLocalWallet: (input: unknown) => Promise<WalletAdapter[] | null>;
}
