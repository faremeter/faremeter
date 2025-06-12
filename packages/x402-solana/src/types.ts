import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface PaymentRequirements {
  receiver: PublicKey;
  amount: number;
}

type base64 = string;
export type Uint8Array32 = Uint8Array & { length: 32 };
export interface Payment {
  versionedTransaction: VersionedTransaction;
  payer: PublicKey;
  // nonce: Uint8Array32
}

export interface PaymentHeader {
  versionedTransaction: base64;
  payer: string;
  signature: string;
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
