import { randomBytes } from "crypto";
import type {
  PaymentHandler,
  PaymentExecer,
  RequestContext,
} from "@faremeter/types";
import {
  isKnownNetwork,
  lookupKnownNetwork,
  lookupKnownAsset,
} from "@faremeter/info/evm";
import type { x402PaymentRequirements } from "@faremeter/types/x402";
import type { Hex } from "viem";
import { isAddress } from "viem";
import { type } from "arktype";
import {
  X402_EXACT_SCHEME,
  EIP712_TYPES,
  eip712Domain,
  type x402ExactPayload,
  type eip3009Authorization,
} from "./constants";

interface WalletForPayment {
  network: string;
  address: Hex;
  account: {
    signTypedData: (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => Promise<Hex>;
  };
}

export function createPaymentHandler(wallet: WalletForPayment): PaymentHandler {
  if (!isKnownNetwork(wallet.network)) {
    throw new Error(
      `Wallet was created for unsupported network '${wallet.network}'`,
    );
  }

  const networkInfo = lookupKnownNetwork(wallet.network);
  if (!networkInfo) {
    throw new Error(
      `Couldn't look up network info for network '${wallet.network}'`,
    );
  }

  const assetInfo = lookupKnownAsset(wallet.network, "USDC");
  if (!assetInfo) {
    throw new Error(
      `Couldn't look up USDC information on network '${wallet.network}'`,
    );
  }

  return async function handlePayment(
    context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> {
    const compatibleRequirements = accepts.filter(
      (req) =>
        req.scheme === X402_EXACT_SCHEME && req.network === wallet.network,
    );

    return compatibleRequirements.map((requirements) => ({
      requirements,
      exec: async () => {
        if (!isAddress(requirements.payTo)) {
          throw new Error(`Invalid payTo address: ${requirements.payTo}`);
        }
        const payToAddress = requirements.payTo;

        // Generate nonce for EIP-3009 authorization (32 bytes hex with 0x prefix)
        const nonce = `0x${randomBytes(32).toString("hex")}` as const;
        const now = Math.floor(Date.now() / 1000);
        const validAfter = now - 60; // Valid from 60 seconds ago
        const validBefore = now + requirements.maxTimeoutSeconds;

        // Create the authorization parameters for EIP-3009
        const authorization: eip3009Authorization = {
          from: wallet.address,
          to: payToAddress,
          value: requirements.maxAmountRequired, // String value of amount
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce: nonce,
        };

        // Validate and extract EIP-712 domain parameters from requirements.extra
        const extraResult = eip712Domain(requirements.extra ?? {});
        if (extraResult instanceof type.errors) {
          throw new Error(
            `Invalid EIP-712 domain parameters: ${extraResult.summary}`,
          );
        }

        const domain = {
          name: extraResult.name ?? assetInfo.name,
          version: extraResult.version ?? "2",
          chainId: extraResult.chainId ?? networkInfo.chainId,
          verifyingContract: (() => {
            const asset =
              extraResult.verifyingContract ??
              requirements.asset ??
              assetInfo.address;
            if (!isAddress(asset)) {
              throw new Error(`Invalid asset address: ${asset}`);
            }
            return asset;
          })(),
        } as const;

        const types = EIP712_TYPES;

        // Message for EIP-712 signing (using BigInt for signing)
        const message = {
          from: wallet.address,
          to: payToAddress,
          value: BigInt(requirements.maxAmountRequired),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce,
        };

        // Sign the EIP-712 typed data
        const signature = await wallet.account.signTypedData({
          domain,
          types,
          primaryType: "TransferWithAuthorization",
          message,
        });

        // Create the x402 exact scheme payload
        const payload: x402ExactPayload = {
          signature: signature,
          authorization: authorization,
        };

        // Return the EIP-3009 authorization payload
        return {
          payload,
        };
      },
    }));
  };
}
