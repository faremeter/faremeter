/* eslint-disable @typescript-eslint/no-non-null-assertion */
//
// Disable checks for no-non-null-assertions until this is
// production ready.
//

import { PublicKey } from "@solana/web3.js";
import {
  type RequestContext,
  type x402PaymentRequirements,
  isValidationError,
  throwValidationError,
} from "@faremeter/types";

import {
  createCrossmint,
  CrossmintWallets,
  SolanaWallet,
} from "@crossmint/wallets-sdk";

import { PaymentRequirementsExtra } from "./types";
import { createPaymentHeader } from "./header";
import { createPaymentTransaction } from "./solana";

export function createCrossmintPaymentHandler(
  crossmintApiKey: string,
  crossmintWalletAddress: string,
) {
  return async (ctx: RequestContext, accepts: x402PaymentRequirements[]) => {
    const requirements = accepts[0]!;
    const extra = PaymentRequirementsExtra(requirements.extra);

    if (isValidationError(extra)) {
      throwValidationError("couldn't validate requirements extra field", extra);
    }

    const exec = async () => {
      const crossmint = createCrossmint({
        apiKey: crossmintApiKey,
      });
      const crossmintWallets = CrossmintWallets.from(crossmint);
      const wallet = await crossmintWallets.getWallet(crossmintWalletAddress, {
        chain: "solana",
        signer: {
          type: "api-key",
        },
      });
      console.log(wallet.address);

      const solanaWallet = SolanaWallet.from(wallet);
      const walletPubkey = new PublicKey(solanaWallet.address);

      const tx = await createPaymentTransaction(
        {
          ...extra,
          amount: Number(requirements.maxAmountRequired),
          receiver: new PublicKey(requirements.payTo),
          admin: new PublicKey(requirements.asset),
        },
        walletPubkey,
      );

      const solTx = await solanaWallet.sendTransaction({
        transaction: tx as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      });

      console.log(solTx);

      const header = createPaymentHeader(walletPubkey, undefined, solTx.hash);
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
