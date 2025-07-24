import { type } from "arktype";
import type { Wallet } from "./types";
import { x402Scheme } from "./facilitator";
import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  type RequestContext,
  type x402PaymentRequirements,
  type PaymentExecer,
  isValidationError,
  throwValidationError,
} from "@faremeter/types";

import { PaymentRequirementsExtra, createPaymentPayload } from "./types";
import {
  createSolPaymentInstruction,
  createSplPaymentInstruction,
} from "./solana";

async function sendTransaction(
  wallet: Wallet,
  instructions: TransactionInstruction[],
  recentBlockhash: string,
) {
  let tx: VersionedTransaction;

  if (wallet.buildTransaction) {
    tx = await wallet.buildTransaction(instructions, recentBlockhash);
  } else {
    const message = new TransactionMessage({
      instructions,
      payerKey: wallet.publicKey,
      recentBlockhash,
    }).compileToV0Message();

    tx = new VersionedTransaction(message);
  }

  let payload;

  if (wallet.updateTransaction) {
    tx = await wallet.updateTransaction(tx);
  }

  if (wallet.sendTransaction) {
    const hash = await wallet.sendTransaction(tx);
    payload = createPaymentPayload(wallet.publicKey, undefined, hash);
  } else {
    payload = createPaymentPayload(wallet.publicKey, tx);
  }

  return {
    payload,
  };
}

export function createPaymentHandler(wallet: Wallet, mint?: PublicKey) {
  const matcher = type({
    scheme: `'${x402Scheme}'`,
    network: `'${wallet.network}'`,
    asset: `'${mint ? mint.toBase58() : "sol"}'`,
  });

  return async (
    ctx: RequestContext,
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
            admin: new PublicKey(extra.admin),
          };

          const instructions = [
            mint
              ? await createSplPaymentInstruction(
                  paymentRequirements,
                  mint,
                  wallet.publicKey,
                )
              : await createSolPaymentInstruction(
                  paymentRequirements,
                  wallet.publicKey,
                ),
          ];
          return await sendTransaction(
            wallet,
            instructions,
            extra.recentBlockhash,
          );
        };

        return {
          exec,
          requirements,
        };
      });

    return res;
  };
}
