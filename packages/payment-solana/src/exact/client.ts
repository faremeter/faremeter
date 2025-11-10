import type { x402PaymentRequirements } from "@faremeter/types/x402";
import { isValidationError, throwValidationError } from "@faremeter/types";
import type {
  PaymentExecer,
  PaymentHandler,
  RequestContext,
} from "@faremeter/types/client";
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
import { PaymentRequirementsExtra } from "./facilitator";
import { generateMatcher } from "./common";

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

interface GetAssociatedTokenAddressSyncOptions {
  allowOwnerOffCurve?: boolean;
  programId?: PublicKey;
  associatedTokenProgramId?: PublicKey;
}

function generateGetAssociatedTokenAddressSyncRest(
  tokenConfig: GetAssociatedTokenAddressSyncOptions,
) {
  const { allowOwnerOffCurve, programId, associatedTokenProgramId } =
    tokenConfig;

  // NOTE: These map to the trailing default args of
  // getAssociatedTokenAddressSync, so order matters. If things are
  // refactored, they should be updated to match the reality of the
  // implementation.

  return [allowOwnerOffCurve, programId, associatedTokenProgramId] as const;
}

interface CreatePaymentHandlerOptions {
  token?: GetAssociatedTokenAddressSyncOptions;
}

export function createPaymentHandler(
  wallet: Wallet,
  mint: PublicKey,
  connection?: Connection,
  options?: CreatePaymentHandlerOptions,
): PaymentHandler {
  const getAssociatedTokenAddressSyncRest =
    generateGetAssociatedTokenAddressSyncRest(options?.token ?? {});

  const { isMatchingRequirement } = generateMatcher(
    wallet.network,
    mint ? mint.toBase58() : "sol",
  );

  return async (
    _context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> => {
    const res = accepts.filter(isMatchingRequirement).map((requirements) => {
      const extra = PaymentRequirementsExtra(requirements.extra);

      if (isValidationError(extra)) {
        throwValidationError(
          "couldn't validate requirements extra field",
          extra,
        );
      }

      const exec = async () => {
        let recentBlockhash: string;

        if (extra.recentBlockhash !== undefined) {
          recentBlockhash = extra.recentBlockhash;
        } else if (connection !== undefined) {
          recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        } else {
          throw new Error("couldn't get the latest Solana network block hash");
        }

        let decimals: number;

        if (extra.decimals !== undefined) {
          decimals = extra.decimals;
        } else if (connection !== undefined) {
          const mintInfo = await getMint(connection, mint);
          decimals = mintInfo.decimals;
        } else {
          throw new Error("couldn't get the decimal information for the mint");
        }

        const paymentRequirements = {
          ...extra,
          amount: Number(requirements.maxAmountRequired),
          receiver: new PublicKey(requirements.payTo),
        };

        const sourceAccount = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          ...getAssociatedTokenAddressSyncRest,
        );

        const receiverAccount = getAssociatedTokenAddressSync(
          mint,
          paymentRequirements.receiver,
          ...getAssociatedTokenAddressSyncRest,
        );

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
            decimals,
          ),
        ];

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
