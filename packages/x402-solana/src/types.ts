import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { default as BN } from "bn.js";
import { type } from "arktype";
import bs58 from "bs58";

const VersionedTransactionString = type("string").pipe.try((tx) => {
  const decoded = bs58.decode(tx);
  return VersionedTransaction.deserialize(decoded);
});

export const Payment = type({
  payer: "string",
}).and(
  type({
    type: "'transaction'",
    versionedTransaction: VersionedTransactionString,
  }).or({
    type: "'signature'",
    transactionSignature: "string",
  }),
);

export type Payment = typeof Payment.infer;

export const PaymentHeader = type({
  payer: "string",
}).and(
  type({
    type: "'transaction'",
    versionedTransaction: "string",
  }).or({
    type: "'signature'",
    transactionSignature: "string",
  }),
);

export type PaymentHeader = typeof PaymentHeader.infer;

export interface PaymentRequirements {
  receiver: PublicKey;
  admin: PublicKey;
  amount: number;
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
