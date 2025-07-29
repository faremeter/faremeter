import { type } from "arktype";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  type FacilitatorHandler,
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
} from "@faremeter/types";
import { PaymentPayload } from "./types";

import { isValidationError } from "@faremeter/types";

import {
  createSettleTransaction,
  extractTransferData,
  isValidTransferTransaction,
  processTransaction,
} from "./solana";

function errorResponse(msg: string): x402SettleResponse {
  return {
    success: false,
    error: msg,
    txHash: null,
    networkId: null,
  };
}

export const x402Scheme = "@faremeter/x402-solana";

export const createFacilitatorHandler = (
  network: string,
  connection: Connection,
  adminKeypair: Keypair,
  mint?: PublicKey,
): FacilitatorHandler => {
  const checkTuple = type({
    scheme: `'${x402Scheme}'`,
    network: `'${network}'`,
  });

  const asset = mint ? mint.toBase58() : "sol";
  const checkTupleAndAsset = checkTuple.and({ asset: `'${asset}'` });

  const getRequirements = async (req: x402PaymentRequirements[]) => {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    return req
      .filter((x) => !isValidationError(checkTupleAndAsset(x)))
      .map((x) => {
        return {
          ...x,
          asset: mint ? mint.toBase58() : "sol",
          maxTimeoutSeconds: 5,
          extra: {
            admin: adminKeypair.publicKey.toString(),
            recentBlockhash,
          },
        };
      });
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => {
    const tupleMatches = checkTuple(payment);

    if (isValidationError(tupleMatches)) {
      return null;
    }

    const paymentPayload = PaymentPayload(payment.payload);

    if (isValidationError(paymentPayload)) {
      return errorResponse(paymentPayload.summary);
    }

    const signature =
      paymentPayload.type == "transaction"
        ? await processTransaction(
            connection,
            paymentPayload.versionedTransaction,
          )
        : paymentPayload.transactionSignature;

    if (!signature) {
      return errorResponse("invalid signature");
    }

    console.log("Payment signature", signature);

    const isValidTx = await isValidTransferTransaction(connection, signature);
    if (!isValidTx) {
      console.log("invalid transaction");
      return errorResponse("invalid transaction");
    }

    const transactionData = await extractTransferData(connection, signature);
    if (!transactionData.success) {
      console.log("couldn't extract transfer data");
      return errorResponse("could not extract transfer data");
    }

    if (
      Number(transactionData.data.amount) !==
      Number(requirements.maxAmountRequired)
    ) {
      console.log("payments didn't match amount");
      return errorResponse("payments didn't match amount");
    }

    const settleTx = await createSettleTransaction(
      connection,
      adminKeypair,
      transactionData.payer,
      transactionData.data.nonce,
    );
    if (!settleTx) {
      console.log("couldn't create settle tx");
      return errorResponse("couldn't create settlement tx");
    }

    const settleSig = await processTransaction(connection, settleTx);

    if (settleSig == null) {
      console.log("couldn't process settlement");
      return errorResponse("couldn't process settlement");
    }

    return {
      success: true,
      error: null,
      txHash: settleSig,
      networkId: payment.network,
    };
  };

  return {
    getRequirements,
    handleSettle,
  };
};
