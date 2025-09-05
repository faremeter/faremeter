import {
  isValidationError,
  x402PaymentPayload,
  x402PaymentRequirements,
  x402SettleResponse,
  type FacilitatorHandler,
} from "@faremeter/types";
import { fetchMint } from "@solana-program/token";
import {
  address,
  createKeyPairSignerFromBytes,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  type Transaction,
} from "@solana/transactions";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { type } from "arktype";
import { isValidTransaction } from "./verify";

export const x402Scheme = "exact";

export const PaymentRequirementsExtra = type({
  feePayer: "string",
});

function errorResponse(msg: string): x402SettleResponse {
  return {
    success: false,
    error: msg,
    txHash: null,
    networkId: null,
  };
}

const TransactionString = type("string").pipe.try((tx) => {
  const decoder = getTransactionDecoder();
  const base64Encoder = getBase64Encoder();
  const transactionBytes = base64Encoder.encode(tx);
  return decoder.decode(transactionBytes);
});

export const PaymentPayload = type({
  transaction: TransactionString,
});

export const lookupX402Network = (network: string) => {
  return `solana-${network}`;
};

const sendTransaction = async (
  rpc: Rpc<SolanaRpcApi>,
  signedTransaction: Transaction,
  maxRetries: number,
  retryDelayMs: number,
): Promise<
  { success: true; signature: string } | { success: false; error: string }
> => {
  const base64EncodedTransaction =
    getBase64EncodedWireTransaction(signedTransaction);

  const simResult = await rpc
    .simulateTransaction(base64EncodedTransaction, {
      encoding: "base64",
    })
    .send();

  if (simResult.value.err) {
    console.log("transaction simulation failed", simResult.value.err);
    return { success: false, error: "Transaction simulation failed" };
  }

  const signature = await rpc
    .sendTransaction(base64EncodedTransaction, {
      encoding: "base64",
    })
    .send();

  for (let i = 0; i < maxRetries; i++) {
    const status = await rpc.getSignatureStatuses([signature]).send();
    if (status.value[0]?.err) {
      return {
        success: false,
        error: `Transaction failed: ${JSON.stringify(status.value[0].err)}`,
      };
    }
    if (
      status.value[0]?.confirmationStatus === "confirmed" ||
      status.value[0]?.confirmationStatus === "finalized"
    ) {
      return { success: true, signature };
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { success: false, error: "Transaction confirmation timeout" };
};

export const createFacilitatorHandler = (
  network: string,
  rpc: Rpc<SolanaRpcApi>,
  feePayerKeypair: Keypair,
  mint: PublicKey,
  maxRetries = 30,
  retryDelayMs = 1000,
): FacilitatorHandler => {
  const checkTuple = type({
    scheme: `'${x402Scheme}'`,
    network: `'${network}'`,
  });
  const checkTupleAndAsset = checkTuple.and({ asset: `'${mint.toBase58()}'` });

  const getRequirements = async (req: x402PaymentRequirements[]) => {
    const recentBlockhash = (await rpc.getLatestBlockhash().send()).value
      .blockhash;
    const mintInfo = await fetchMint(rpc, address(mint.toBase58()));
    return req
      .filter((x) => !isValidationError(checkTupleAndAsset(x)))
      .map((x) => {
        return {
          ...x,
          asset: mint.toBase58(),
          extra: {
            feePayer: feePayerKeypair.publicKey.toString(),
            decimals: mintInfo.data.decimals,
            recentBlockhash,
          },
        };
      });
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => {
    if (isValidationError(checkTuple(payment))) {
      return errorResponse("error validating");
    }

    const paymentPayload = PaymentPayload(payment.payload);
    if (isValidationError(paymentPayload)) {
      return errorResponse(paymentPayload.summary);
    }

    try {
      const transaction = paymentPayload.transaction;
      const compiledTransactionMessage =
        getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      const transactionMessage = decompileTransactionMessage(
        compiledTransactionMessage,
      );

      if (!isValidTransaction(transactionMessage, requirements)) {
        console.log("Invalid transaction");
        return errorResponse("Invalid transaction");
      }

      const kitKeypair = await createKeyPairSignerFromBytes(
        feePayerKeypair.secretKey,
      );
      const signedTransaction = await partiallySignTransaction(
        [kitKeypair.keyPair],
        transaction,
      );

      const result = await sendTransaction(
        rpc,
        signedTransaction,
        maxRetries,
        retryDelayMs,
      );

      if (!result.success) {
        return errorResponse(result.error);
      }

      return {
        success: true,
        error: null,
        txHash: result.signature,
        networkId: payment.network,
      };
    } catch (error) {
      console.error("Transaction failed:", error);
      return errorResponse(`Transaction failed`);
    }
  };

  return {
    getRequirements,
    handleSettle,
  };
};
