import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Payment, PaymentHeader } from "./types";
import type { Request } from "express";
import bs58 from "bs58";

export const extractPaymentFromHeader = (req: Request): Payment | null => {
  try {
    const paymentHeader = req.header("X-PAYMENT");

    if (!paymentHeader) {
      return null;
    }

    const paymentData: PaymentHeader = JSON.parse(paymentHeader);

    if (!paymentData.versionedTransaction || !paymentData.payer) {
      throw new Error("Missing required fields");
    }

    const payerPublicKey = new PublicKey(paymentData.payer);

    const transactionBuffer = bs58.decode(paymentData.versionedTransaction);
    const versionedTransaction =
      VersionedTransaction.deserialize(transactionBuffer);

    return {
      versionedTransaction,
      payer: payerPublicKey,
    };
  } catch (error) {
    console.error("Failed to extract payment from header:", error);
    return null;
  }
};

export function createPaymentHeader(
  versionedTransaction: VersionedTransaction,
  payer: PublicKey,
): string {
  const versionedTransactionB58 = bs58.encode(versionedTransaction.serialize());
  const payerB58 = payer.toBase58();

  const paymentHeader: PaymentHeader = {
    versionedTransaction: versionedTransactionB58,
    payer: payerB58,
  };

  return JSON.stringify(paymentHeader);
}
