import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Request } from "express";
import bs58 from "bs58";
import { Payment, PaymentHeader } from "./types";
import { isValidationError } from "@faremeter/types";

export const extractPaymentFromHeader = (req: Request): Payment | null => {
  try {
    const paymentHeader = req.header("X-PAYMENT");
    if (!paymentHeader) {
      return null;
    }

    const paymentData = Payment(JSON.parse(paymentHeader));

    if (isValidationError(paymentData)) {
      console.log("type error:", paymentData.summary);
      return null;
    }

    return paymentData;
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

  const payerB58 = payer.toBase58();

  if (versionedTransaction) {
    const versionedTransactionB58 = bs58.encode(
      versionedTransaction.serialize(),
    );

    return JSON.stringify(
      PaymentHeader({
        type: "transaction",
        versionedTransaction: versionedTransactionB58,
        payer: payerB58,
      }),
    );
  } else {
    return JSON.stringify(
      PaymentHeader({
        type: "signature",
        transactionSignature,
        payer: payerB58,
      }),
    );
  }
}
