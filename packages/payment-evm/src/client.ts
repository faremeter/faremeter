import { randomBytes } from "crypto";
import type {
  PaymentHandler,
  PaymentExecer,
  RequestContext,
} from "@faremeter/types";
import type { x402PaymentRequirements } from "@faremeter/types";
import type { Hex } from "viem";
import { isAddress } from "viem";

const X402_EXACT_SCHEME = "exact";
const USDC_BASE_SEPOLIA = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

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
        const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
        const now = Math.floor(Date.now() / 1000);
        const validAfter = now - 60; // Valid from 60 seconds ago
        const validBefore = now + requirements.maxTimeoutSeconds;

        // Create the authorization parameters for EIP-3009
        const authorization = {
          from: wallet.address,
          to: payToAddress,
          value: requirements.maxAmountRequired, // String value of amount
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce: nonce,
        };

        // EIP-712 domain for USDC on Base Sepolia
        const extra = requirements.extra as
          | { name?: string; version?: string }
          | undefined;
        const domain = {
          name: extra?.name || "USD Coin",
          version: extra?.version || "2",
          chainId: 84532,
          verifyingContract: (() => {
            const asset = requirements.asset || USDC_BASE_SEPOLIA;
            if (!isAddress(asset)) {
              throw new Error(`Invalid asset address: ${asset}`);
            }
            return asset;
          })(),
        } as const;

        const types = {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        } as const;

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
        const payload = {
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
