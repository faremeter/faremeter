/* eslint-disable @typescript-eslint/no-non-null-assertion */
//
// Disable checks for no-non-null-assertions until this is
// production ready.
//

import { PublicKey, Keypair } from "@solana/web3.js";

import {
  type RequestContext,
  type x402PaymentRequirements,
  isValidationError,
  throwValidationError,
} from "@faremeter/types";

import { PaymentRequirementsExtra } from "./types";

import {
  createPaymentTransaction,
  createPaymentSplTransaction,
} from "./solana";

import { createPaymentHeader } from "./header";

export function createBasicPaymentHandler(keypair: Keypair) {
  return async (ctx: RequestContext, accepts: x402PaymentRequirements[]) => {
    // XXX - We need to decide how to filter for possibilities.
    const requirements = accepts[0]!;

    const extra = PaymentRequirementsExtra(requirements.extra);

    if (isValidationError(extra)) {
      throwValidationError("couldn't validate requirements extra field", extra);
    }

    const exec = async () => {
      const tx = await createPaymentTransaction(
        {
          ...extra,
          amount: Number(requirements.maxAmountRequired),
          receiver: new PublicKey(requirements.payTo),
          admin: new PublicKey(requirements.asset),
        },
        keypair.publicKey,
      );
      tx.sign([keypair]);

      const header = createPaymentHeader(keypair.publicKey, tx);
      return {
        headers: {
          "X-PAYMENT": header,
        },
      };
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}

export function createTokenPaymentHandler(keypair: Keypair, mint: PublicKey) {
  return async (ctx: RequestContext, accepts: x402PaymentRequirements[]) => {
    // XXX - We need to decide how to filter for possibilities.
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

      const tx = await createPaymentSplTransaction(
        paymentRequirements,
        mint,
        keypair.publicKey,
      );
      tx.sign([keypair]);

      const header = createPaymentHeader(keypair.publicKey, tx);

      return {
        headers: {
          "X-PAYMENT": header,
        },
      };
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}
