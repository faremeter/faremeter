/* eslint-disable @typescript-eslint/no-non-null-assertion */
//
// Disable checks for no-non-null-assertions until this is
// production ready.
//

import type { Wallet } from "./types";
import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  type RequestContext,
  type x402PaymentRequirements,
  isValidationError,
  throwValidationError,
} from "@faremeter/types";

import { PaymentRequirementsExtra } from "./types";
import { createPaymentPayload } from "./header";
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

export function createSolPaymentHandler(wallet: Wallet) {
  return async (ctx: RequestContext, accepts: x402PaymentRequirements[]) => {
    const requirements = accepts[0]!;
    const extra = PaymentRequirementsExtra(requirements.extra);

    if (isValidationError(extra)) {
      throwValidationError("couldn't validate requirements extra field", extra);
    }

    const exec = async () => {
      const paymentRequirements = {
        ...extra,
        amount: Number(requirements.maxAmountRequired),
        receiver: new PublicKey(requirements.payTo),
        admin: new PublicKey(requirements.asset),
      };

      const instructions = [
        await createSolPaymentInstruction(
          paymentRequirements,
          wallet.publicKey,
        ),
      ];
      return await sendTransaction(wallet, instructions, extra.recentBlockhash);
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}

export function createTokenPaymentHandler(wallet: Wallet, mint: PublicKey) {
  return async (ctx: RequestContext, accepts: x402PaymentRequirements[]) => {
    const requirements = accepts[0]!;
    const extra = PaymentRequirementsExtra(requirements.extra);

    if (isValidationError(extra)) {
      throwValidationError("couldn't validate requirements extra field", extra);
    }

    const exec = async () => {
      const paymentRequirements = {
        ...extra,
        amount: Number(requirements.maxAmountRequired),
        receiver: new PublicKey(requirements.payTo),
        admin: new PublicKey(requirements.asset),
      };

      const instructions = [
        await createSplPaymentInstruction(
          paymentRequirements,
          mint,
          wallet.publicKey,
        ),
      ];
      return await sendTransaction(wallet, instructions, extra.recentBlockhash);
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}
