import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { default as BN } from "bn.js";
import { type } from "arktype";
import bs58 from "bs58";

const VersionedTransactionString = type("string").pipe.try((tx) => {
  const decoded = bs58.decode(tx);
  return VersionedTransaction.deserialize(decoded);
});

export const PaymentPayload = type({
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

export type PaymentPayload = typeof PaymentPayload.infer;

export interface PaymentTargetInfo {
  receiver: PublicKey;
  admin: PublicKey;
  amount: number;
  recentBlockhash: string;
}

export interface CreatePaymentArgs {
  amount: BN;
  nonce: number[];
}

export const PaymentRequirementsExtra = type({
  recentBlockhash: "string",
});

export type PaymentRequirementsExtra = typeof PaymentRequirementsExtra.infer;

export type Wallet = {
  publicKey: PublicKey;
  buildTransaction?: (
    instructions: TransactionInstruction[],
    recentBlockHash: string,
  ) => Promise<VersionedTransaction>;
  updateTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  sendTransaction?: (tx: VersionedTransaction) => Promise<string>;
};
