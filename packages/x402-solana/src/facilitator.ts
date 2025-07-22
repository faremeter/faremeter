import { PaymentPayload } from "./types";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { NextFunction, Request, Response } from "express";
import {
  isValidationError,
  headerToX402PaymentPayload,
} from "@faremeter/types";

import {
  createSettleTransaction,
  extractTransferData,
  isValidTransferTransaction,
  processTransaction,
  settleTransaction,
} from "./solana";

export type PaymentRequirements = {
  payTo: PublicKey;
  amount: number;
};

function extractPaymentFromHeader(req: Request) {
  const paymentHeader = req.header("X-PAYMENT");
  if (!paymentHeader) {
    return null;
  }

  const payload = headerToX402PaymentPayload(paymentHeader);
  if (isValidationError(payload)) {
    console.log("type validation error:", payload.summary);
    return null;
  }

  return payload;
}

export const paymentMiddleware = (
  connection: Connection,
  paymentRequirements: PaymentRequirements,
  adminKeypair: Keypair,
) => {
  const sendPaymentRequired = async (res: Response) => {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

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
          payTo: paymentRequirements.payTo.toString(),
          asset: adminKeypair.publicKey.toString(),
          maxTimeoutSeconds: 5,
          extra: {
            recentBlockhash,
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

      const paymentPayload = PaymentPayload(payment.payload);

      if (isValidationError(paymentPayload)) {
        console.log("type validation error:", paymentPayload.summary);
        return sendPaymentRequired(res);
      }

      const signature =
        paymentPayload.type == "transaction"
          ? await processTransaction(
              connection,
              paymentPayload.versionedTransaction,
            )
          : paymentPayload.transactionSignature;

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
