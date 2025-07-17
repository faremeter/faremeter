import { Connection, Keypair } from "@solana/web3.js";
import type { NextFunction, Request, Response } from "express";
import { type PaymentTargetInfo } from "./types";
import { extractPaymentFromHeader } from "./header";
import {
  createSettleTransaction,
  extractTransferData,
  isValidTransferTransaction,
  processTransaction,
  settleTransaction,
} from "./solana";

export const paymentMiddleware = (
  connection: Connection,
  paymentRequirements: PaymentTargetInfo,
  adminKeypair: Keypair,
) => {
  const sendPaymentRequired = async (res: Response) => {
    const blockHash = (await connection.getLatestBlockhash()).blockhash;

    res.status(402).json({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "solana",
          maxAmountRequired: paymentRequirements.amount.toString(),
          resource: "http://whatever.com",
          description: "what else",
          mimeType: "what",
          payTo: paymentRequirements.receiver.toString(),
          asset: paymentRequirements.admin.toString(),
          maxTimeoutSeconds: 5,
          extra: {
            blockHash,
          },
        },
      ],
    });
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payment = extractPaymentFromHeader(req);
      if (!payment) {
        return sendPaymentRequired(res);
      }

      const signature =
        "versionedTransaction" in payment
          ? await processTransaction(connection, payment.versionedTransaction)
          : payment.transactionSignature;

      if (!signature) {
        return sendPaymentRequired(res);
      }

      console.log("Payment signature", signature);

      const isValidTx = await isValidTransferTransaction(connection, signature);
      if (!isValidTx) {
        console.log("invalid transaction");
        return sendPaymentRequired(res);
      }

      const transactionData = await extractTransferData(connection, signature);
      if (!transactionData.success) {
        console.log("couldn't extract transfer data");
        return sendPaymentRequired(res);
      }

      if (Number(transactionData.data.amount) !== paymentRequirements.amount) {
        console.log("payments didn't match amount");
        return sendPaymentRequired(res);
      }

      const settleTx = await createSettleTransaction(
        connection,
        adminKeypair,
        transactionData.payer,
        transactionData.data.nonce,
      );
      if (!settleTx) {
        console.log("couldn't create settle tx");
        return sendPaymentRequired(res);
      }

      const settleResult = await settleTransaction(connection, settleTx);
      if (!settleResult.success) {
        console.log("couldn't send settle");
        return sendPaymentRequired(res);
      }

      next();
    } catch (error) {
      console.error("Payment middleware error:", error);
      sendPaymentRequired(res);
    }
  };
};
