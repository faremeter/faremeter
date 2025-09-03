import {
  isValidationError,
  throwValidationError,
  caseInsensitiveLiteral,
  type PaymentExecer,
  type PaymentHandler,
  type RequestContext,
  type x402PaymentRequirements,
} from "@faremeter/types";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  getBase64EncodedWireTransaction,
  type SignaturesMap,
  type TransactionMessageBytes,
} from "@solana/transactions";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { type } from "arktype";
import { PaymentRequirementsExtra, x402Scheme } from "./facilitator";

export type Wallet = {
  network: string;
  publicKey: PublicKey;
  buildTransaction?: (
    instructions: TransactionInstruction[],
    recentBlockHash: string,
  ) => Promise<VersionedTransaction>;
  updateTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  sendTransaction?: (tx: VersionedTransaction) => Promise<string>;
};

export function createPaymentHandler(
  wallet: Wallet,
  mint: PublicKey,
  connection: Connection,
): PaymentHandler {
  const matcher = type({
    scheme: caseInsensitiveLiteral(x402Scheme),
    network: caseInsensitiveLiteral(wallet.network),
    asset: caseInsensitiveLiteral(mint ? mint.toBase58() : "sol"),
  });

  return async (
    context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> => {
    const res = accepts
      .filter((r) => !isValidationError(matcher(r)))
      .map((requirements) => {
        const extra = PaymentRequirementsExtra(requirements.extra);

        if (isValidationError(extra)) {
          throwValidationError(
            "couldn't validate requirements extra field",
            extra,
          );
        }

        const exec = async () => {
          const paymentRequirements = {
            ...extra,
            amount: Number(requirements.maxAmountRequired),
            receiver: new PublicKey(requirements.payTo),
          };

          const sourceAccount = getAssociatedTokenAddressSync(
            mint,
            wallet.publicKey,
          );

          const receiverAccount = getAssociatedTokenAddressSync(
            mint,
            paymentRequirements.receiver,
          );

          const mintInfo = await getMint(connection, mint);

          const instructions = [
            ComputeBudgetProgram.setComputeUnitLimit({
              units: 50_000,
            }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: 1,
            }),
            createTransferCheckedInstruction(
              sourceAccount,
              mint,
              receiverAccount,
              wallet.publicKey,
              paymentRequirements.amount,
              mintInfo.decimals,
            ),
          ];

          const recentBlockhash = (await connection.getLatestBlockhash())
            .blockhash;

          let tx: VersionedTransaction;

          if (wallet.buildTransaction) {
            tx = await wallet.buildTransaction(instructions, recentBlockhash);
          } else {
            const message = new TransactionMessage({
              instructions,
              payerKey: new PublicKey(paymentRequirements.feePayer),
              recentBlockhash,
            }).compileToV0Message();

            tx = new VersionedTransaction(message);
          }

          if (wallet.updateTransaction) {
            tx = await wallet.updateTransaction(tx);
          }

          const base64EncodedWireTransaction = getBase64EncodedWireTransaction({
            messageBytes:
              tx.message.serialize() as unknown as TransactionMessageBytes,
            signatures: tx.signatures as unknown as SignaturesMap,
          });

          const payload = {
            transaction: base64EncodedWireTransaction,
          };

          return { payload };
        };

        return {
          exec,
          requirements,
        };
      });

    return res;
  };
}
