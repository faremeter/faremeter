import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Payment, PaymentHeader } from "./types";
import type { Request } from "express";
import { sign } from "tweetnacl";
import bs58 from "bs58";

export const extractPaymentFromHeader = (req: Request): Payment | null => {
  try {
    const paymentHeader = req.header("X-PAYMENT");

    if (!paymentHeader) {
      return null;
    }

    const paymentData: PaymentHeader = JSON.parse(paymentHeader);

    if (
      !paymentData.versionedTransaction ||
      !paymentData.payer ||
      !paymentData.signature
    ) {
      throw new Error("Missing required fields");
    }

    const message = paymentData.versionedTransaction + paymentData.payer;
    const messageBytes = new TextEncoder().encode(message);

    const signatureBytes = bs58.decode(paymentData.signature);

    const payerPublicKey = new PublicKey(paymentData.payer);
    const publicKeyBytes = payerPublicKey.toBytes();

    const isValid = sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes,
    );

    if (!isValid) {
      throw new Error("Signature verification failed");
    }

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
  payer: Keypair,
): string {
  const versionedTransactionB64 = bs58.encode(versionedTransaction.serialize());

  const payerB58 = payer.publicKey.toBase58();

  const message = versionedTransactionB64 + payerB58;
  const messageBytes = new TextEncoder().encode(message);

  const signature = sign.detached(messageBytes, payer.secretKey);
  const signatureB58 = bs58.encode(signature);

  const paymentHeader: PaymentHeader = {
    versionedTransaction: versionedTransactionB64,
    payer: payerB58,
    signature: signatureB58,
  };

  return JSON.stringify(paymentHeader);
}
