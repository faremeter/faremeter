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

    if (!paymentData.payer) {
      throw new Error("Missing payer field");
    }

    const hasVersionedTransaction =
      paymentData.versionedTransaction &&
      paymentData.versionedTransaction !== undefined;
    const hasSignature =
      paymentData.transactionSignature &&
      paymentData.transactionSignature !== undefined;

    if (hasVersionedTransaction && hasSignature) {
      throw new Error(
        "Cannot provide both versionedTransaction and transactionSignature",
      );
    }

    if (!hasVersionedTransaction && !hasSignature) {
      throw new Error(
        "Must provide either versionedTransaction or transactionSignature",
      );
    }

    const payerPublicKey = new PublicKey(paymentData.payer);

    if (hasVersionedTransaction && paymentData.versionedTransaction) {
      const transactionBuffer = bs58.decode(paymentData.versionedTransaction);
      const versionedTransaction =
        VersionedTransaction.deserialize(transactionBuffer);

      return {
        versionedTransaction,
        transactionSignature: undefined,
        payer: payerPublicKey,
      };
    } else {
      return {
        versionedTransaction: undefined,
        transactionSignature: paymentData.transactionSignature,
        payer: payerPublicKey,
      };
    }
  } catch (error) {
    console.error("Failed to extract payment from header:", error);
    return null;
  }
};

export function createPaymentHeader(
  payer: PublicKey,
  versionedTransaction?: VersionedTransaction,
  transactionSignature?: string,
): string {
  if (versionedTransaction && transactionSignature) {
    throw Error("Cannot pass both transaction and signature");
  }

  const versionedTransactionB58 = versionedTransaction
    ? bs58.encode(versionedTransaction.serialize())
    : undefined;
  const signature = transactionSignature ?? undefined;
  const payerB58 = payer.toBase58();

  const paymentHeader: PaymentHeader = {
    versionedTransaction: versionedTransactionB58,
    transactionSignature: signature,
    payer: payerB58,
  };

  return JSON.stringify(paymentHeader);
}
