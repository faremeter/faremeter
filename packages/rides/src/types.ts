import { x402PaymentId } from "@faremeter/types/x402";
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

export type Balance = {
  name: string;
  amount: bigint;
  decimals: number;
};

export type GetBalance = () => Promise<Balance>;

export interface WalletAdapter {
  x402Id: x402PaymentId[];
  paymentHandler: PaymentHandler;
  getBalance: GetBalance;
}

export interface PayerAdapter {
  addLocalWallet: (input: unknown) => Promise<WalletAdapter[] | null>;
}
