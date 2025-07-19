import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export function createPaymentPayload(
  payer: PublicKey,
  versionedTransaction?: VersionedTransaction,
  transactionSignature?: string,
) {
  if (versionedTransaction && transactionSignature) {
    throw Error("Cannot pass both transaction and signature");
  }

  const payerB58 = payer.toBase58();

  if (versionedTransaction) {
    const versionedTransactionB58 = bs58.encode(
      versionedTransaction.serialize(),
    );

    return {
      type: "transaction",
      versionedTransaction: versionedTransactionB58,
      payer: payerB58,
    };
  } else {
    return {
      type: "signature",
      transactionSignature,
      payer: payerB58,
    };
  }
}
