import { type PaymentHandler } from "@faremeter/types/client";

export const KnownNetworks = [
  "base",
  "base-sepolia",
  "solana",
  "solana-devnet",
] as const;
export type KnownNetwork = (typeof KnownNetworks)[number];

export const KnownAssets = ["USDC"] as const;
export type KnownAsset = (typeof KnownAssets)[number];

export interface WalletAdapter {
  paymentHandler: PaymentHandler;
}

export interface PayerAdapter {
  addLocalWallet: (input: unknown) => Promise<WalletAdapter[] | null>;
}
