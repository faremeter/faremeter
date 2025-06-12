import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import type { NextFunction, Request, Response } from "express";
import { Payment, PaymentHeader, PaymentRequirements } from "./types";
import bs58 from "bs58";
import { sign } from "tweetnacl";
import { extractPaymentFromHeader } from "./header";
import {
  createSettleTransaction,
  extractTransferData,
  isValidTransferTransaction,
  processTransaction,
  settleTransaction,
} from "./solana";
import fs from "fs";

export const paymentMiddleware = (paymentRequirements: PaymentRequirements) => {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("../../keypairs/admin.json", "utf-8")),
    ),
  );

  const sendPaymentRequired = (res: Response) => {
    res.status(402).json({
      msg: "Payment required",
      address: paymentRequirements.receiver.toString(),
      amount: paymentRequirements.amount.toString(),
    });
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payment = extractPaymentFromHeader(req);
      if (!payment) {
        return sendPaymentRequired(res);
      }

      const signature = await processTransaction(
        connection,
        payment.versionedTransaction,
      );
      if (!signature) {
        return sendPaymentRequired(res);
      }

      console.log("Payment signature", signature);

      const isValidTx = await isValidTransferTransaction(connection, signature);
      if (!isValidTx) {
        return sendPaymentRequired(res);
      }

      const transactionData = await extractTransferData(connection, signature);
      if (!transactionData.success) {
        return sendPaymentRequired(res);
      }

      if (Number(transactionData.data.amount) !== paymentRequirements.amount) {
        return sendPaymentRequired(res);
      }

      const settleTx = await createSettleTransaction(
        connection,
        adminKeypair,
        transactionData.payer,
        transactionData.data.nonce,
      );
      if (!settleTx) {
        return sendPaymentRequired(res);
      }

      const settleResult = await settleTransaction(connection, settleTx);
      if (!settleResult.success) {
        return sendPaymentRequired(res);
      }

      next();
    } catch (error) {
      console.error("Payment middleware error:", error);
      sendPaymentRequired(res);
    }
  };
};
