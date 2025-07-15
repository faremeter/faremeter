import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { default as BN } from "bn.js";

export interface PaymentRequirements {
  receiver: PublicKey;
  admin: PublicKey;
  amount: number;
}

type base58 = string;
export type Uint8Array32 = Uint8Array & { length: 32 };
export interface Payment {
  versionedTransaction: VersionedTransaction | undefined;
  transactionSignature: string | undefined;
  payer: PublicKey;
  // nonce: Uint8Array32
}

export interface PaymentHeader {
  versionedTransaction: base58 | undefined;
  transactionSignature: string | undefined;
  payer: string;
}

export interface TransactionVerificationResult {
  success: boolean;
  payer?: PublicKey;
  err?: string;
}

export interface CreatePaymentArgs {
  amount: BN;
  nonce: number[];
}

export interface PaymentResponse {
  address: string;
  admin: string;
  amount: string;
}
