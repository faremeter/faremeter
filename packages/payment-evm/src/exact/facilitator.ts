import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
} from "@faremeter/types/x402";

import { isValidationError, caseInsensitiveLiteral } from "@faremeter/types";
import { type FacilitatorHandler } from "@faremeter/types/facilitator";

import { type } from "arktype";
import type { PublicClient, Hex, WalletClient, Account } from "viem";
import { verifyTypedData, encodeFunctionData, isAddress } from "viem";
import {
  isKnownAsset,
  isKnownNetwork,
  lookupKnownAsset,
  lookupKnownNetwork,
} from "@faremeter/info/evm";

import {
  X402_EXACT_SCHEME,
  TRANSFER_WITH_AUTHORIZATION_ABI,
  EIP712_TYPES,
  x402ExactPayload,
} from "./constants";

function errorResponse(msg: string): x402SettleResponse {
  return {
    success: false,
    error: msg,
    txHash: null,
    networkId: null,
  };
}

const usedNonces = new Set<string>();

function parseSignature(signature: string): { v: number; r: Hex; s: Hex } {
  const sig = signature.slice(2); // Remove 0x
  const r = `0x${sig.slice(0, 64)}` as const;
  const s = `0x${sig.slice(64, 128)}` as const;
  const v = parseInt(sig.slice(128, 130), 16);
  return { v, r, s };
}

export function createFacilitatorHandler(
  network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
  assetName: string,
): FacilitatorHandler {
  if (!isKnownNetwork(network)) {
    throw new Error(`Unknown network ${network}`);
  }

  const networkInfo = lookupKnownNetwork(network);
  if (!networkInfo) {
    throw new Error(`Couldn't look up information for ${network}`);
  }

  const { chainId } = networkInfo;

  if (!isKnownAsset(assetName)) {
    throw new Error(`Unknown asset: ${assetName}`);
  }

  const assetInfo = lookupKnownAsset(network, assetName);
  if (!assetInfo) {
    throw new Error(`Couldn't look up asset ${assetName} on ${network}`);
  }

  const asset = assetInfo.address;

  if (!isAddress(asset)) {
    throw new Error(`Invalid asset address: ${asset}`);
  }

  const checkTuple = type({
    scheme: caseInsensitiveLiteral(X402_EXACT_SCHEME),
    network: caseInsensitiveLiteral(network),
  });

  const checkTupleAndAsset = checkTuple.and({
    asset: caseInsensitiveLiteral(asset),
  });

  const getRequirements = async (
    req: x402PaymentRequirements[],
  ): Promise<x402PaymentRequirements[]> => {
    return req
      .filter((x) => !isValidationError(checkTupleAndAsset(x)))
      .map((x) => ({
        ...x,
        asset,
        maxTimeoutSeconds: 300,
        // Provide EIP-712 domain parameters for client signing
        extra: {
          name: assetInfo.contractName,
          version: "2",
          chainId,
          verifyingContract: asset,
        },
      }));
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ): Promise<x402SettleResponse | null> => {
    const tupleMatches = checkTuple(payment);

    if (isValidationError(tupleMatches)) {
      return null; // Not for us, let another handler try
    }

    // For the exact scheme with EIP-3009, validate the authorization payload
    const payloadResult = x402ExactPayload(payment.payload);
    if (payloadResult instanceof type.errors) {
      return errorResponse(`Invalid payload: ${payloadResult.summary}`);
    }

    const { authorization, signature } = payloadResult;

    // Check if the payment is to the correct address
    if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return errorResponse("Payment authorized to wrong address");
    }

    // Check if the amount matches
    if (authorization.value !== requirements.maxAmountRequired) {
      return errorResponse("Incorrect payment amount");
    }

    // Check if the authorization is still valid (time-wise)
    const now = Math.floor(Date.now() / 1000);
    const validAfter = parseInt(authorization.validAfter);
    const validBefore = parseInt(authorization.validBefore);

    if (now < validAfter) {
      return errorResponse("Authorization not yet valid");
    }

    if (now > validBefore) {
      return errorResponse("Authorization expired");
    }

    // Verify the from address is valid
    if (!isAddress(authorization.from)) {
      return errorResponse("Invalid from address");
    }

    // Check nonce hasn't been used (local check)
    const nonceKey = `${authorization.from}-${authorization.nonce}`;
    if (usedNonces.has(nonceKey)) {
      return errorResponse("Nonce already used");
    }

    // Check on-chain nonce status
    let onChainUsed: boolean;
    try {
      onChainUsed = await publicClient.readContract({
        address: asset,
        abi: TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: "authorizationState",
        args: [authorization.from, authorization.nonce],
      });
    } catch (error) {
      throw new Error("Failed to check authorization status", { cause: error });
    }

    if (onChainUsed) {
      return errorResponse("Authorization already used on-chain");
    }

    // Read domain parameters from chain
    let tokenName: string;
    let tokenVersion: string;
    try {
      [tokenName, tokenVersion] = await Promise.all([
        publicClient.readContract({
          address: asset,
          abi: TRANSFER_WITH_AUTHORIZATION_ABI,
          functionName: "name",
        }),
        publicClient.readContract({
          address: asset,
          abi: TRANSFER_WITH_AUTHORIZATION_ABI,
          functionName: "version",
        }),
      ]);
    } catch (cause) {
      throw new Error("Failed to read contract parameters", { cause });
    }

    const domain = {
      name: tokenName,
      version: tokenVersion ?? "2",
      chainId,
      verifyingContract: asset,
    };

    const types = EIP712_TYPES;

    const message = {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: authorization.nonce,
    };

    // Verify the signature
    let isValidSignature: boolean;
    try {
      isValidSignature = await verifyTypedData({
        address: authorization.from,
        domain,
        types,
        primaryType: "TransferWithAuthorization",
        message,
        signature: signature,
      });
    } catch (cause) {
      throw new Error("Signature verification failed", { cause });
    }

    if (!isValidSignature) {
      return errorResponse("Invalid signature");
    }

    // Verify contract supports EIP-712
    try {
      await publicClient.readContract({
        address: asset,
        abi: TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: "DOMAIN_SEPARATOR",
      });
    } catch (cause) {
      throw new Error("Contract does not support EIP-712", { cause });
    }

    const acct: Account | undefined = walletClient.account;
    if (!acct || acct.type !== "local") {
      return errorResponse(
        "Wallet client is not configured with a local account",
      );
    }

    const { v, r, s } = parseSignature(signature);

    const data = encodeFunctionData({
      abi: TRANSFER_WITH_AUTHORIZATION_ABI,
      functionName: "transferWithAuthorization",
      args: [
        authorization.from,
        authorization.to,
        BigInt(authorization.value),
        BigInt(validAfter),
        BigInt(validBefore),
        authorization.nonce,
        v,
        r,
        s,
      ],
    });

    // Build and send the transaction
    try {
      const request = await walletClient.prepareTransactionRequest({
        to: asset,
        data,
        account: acct,
        chain: undefined,
      });

      const serializedTransaction = await walletClient.signTransaction(request);

      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status !== "success") {
        return errorResponse("Transaction failed");
      }

      usedNonces.add(nonceKey);

      return {
        success: true,
        error: null,
        txHash,
        networkId: chainId.toString(),
      };
    } catch (cause) {
      throw new Error("Transaction execution failed", { cause });
    }
  };

  return {
    getRequirements,
    handleSettle,
  };
}
