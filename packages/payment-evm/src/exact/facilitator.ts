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
  type eip3009Authorization,
  NONCE_KEY_SEPARATOR,
  DEFAULT_TIMEOUT_SECONDS,
  SIGNATURE_LENGTH,
} from "./constants";

import { generateDomain, generateForwarderDomain } from "./common";

function errorResponse(msg: string): x402SettleResponse {
  return {
    success: false,
    error: msg,
    txHash: null,
    networkId: null,
  };
}

// TODO: Consider implementing TTL-based cleanup or LRU cache for production
// to prevent memory leaks from indefinite growth of used nonces
const usedNonces = new Set<string>();

// Contract configuration interface
interface ContractConfig {
  address: `0x${string}`;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
}

function parseSignature(signature: string): { v: number; r: Hex; s: Hex } {
  if (!signature.startsWith("0x")) {
    throw new Error("Signature must start with 0x");
  }

  if (signature.length !== SIGNATURE_LENGTH) {
    throw new Error(
      `Invalid signature length: expected ${SIGNATURE_LENGTH}, got ${signature.length}`,
    );
  }

  const sig = signature.slice(2); // Remove 0x
  const r = `0x${sig.slice(0, 64)}` as const;
  const s = `0x${sig.slice(64, 128)}` as const;
  const v = parseInt(sig.slice(128, 130), 16);

  if (isNaN(v) || v < 0 || v > 255) {
    throw new Error("Invalid signature recovery id");
  }

  return { v, r, s };
}

// Create contract configuration with cached domain
async function createContractConfig(
  useForwarder: boolean,
  chainId: number,
  forwarderVersion: string | undefined,
  forwarderName: string | undefined,
  forwarderAddress: `0x${string}` | undefined,
  publicClient: PublicClient,
  asset: `0x${string}`,
  contractName: string,
): Promise<ContractConfig> {
  const address = getContractAddress(useForwarder, forwarderAddress, asset);

  const domain = useForwarder
    ? generateForwarderDomain(chainId, {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        version: forwarderVersion!,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        name: forwarderName!,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        verifyingContract: forwarderAddress!,
      })
    : await generateDomain(publicClient, chainId, asset);

  // Validate contract name for non-forwarder cases
  if (!useForwarder && domain.name !== contractName) {
    throw new Error(
      `On chain contract name (${domain.name}) doesn't match configured asset name (${contractName})`,
    );
  }

  return { address, domain };
}

// Helper function to get contract address based on forwarder usage
function getContractAddress(
  useForwarder: boolean,
  forwarderAddress: `0x${string}` | undefined,
  asset: `0x${string}`,
): `0x${string}` {
  if (useForwarder) {
    if (!forwarderAddress) {
      throw new Error("Forwarder address is required when using forwarder");
    }
    return forwarderAddress;
  }
  return asset;
}

// Reusable function to validate authorization
function validateAuthorization(
  authorization: eip3009Authorization,
  requirements: x402PaymentRequirements,
): string | null {
  // Check if the payment is to the correct address
  if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return "Payment authorized to wrong address";
  }

  // Check if the amount matches
  if (authorization.value !== requirements.maxAmountRequired) {
    return "Incorrect payment amount";
  }

  // Check if the authorization is still valid (time-wise)
  const now: number = Math.floor(Date.now() / 1000);
  const validAfter: number = parseInt(authorization.validAfter);
  const validBefore: number = parseInt(authorization.validBefore);

  if (now < validAfter) {
    return "Authorization not yet valid";
  }

  if (now > validBefore) {
    return "Authorization expired";
  }

  // Verify the from address is valid
  if (!isAddress(authorization.from)) {
    return "Invalid from address";
  }

  return null;
}

// Reusable function to check nonce usage
async function checkNonceUsage(
  authorization: eip3009Authorization,
  usedNonces: Set<string>,
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
): Promise<string | null> {
  // Check nonce hasn't been used (local check)
  const nonceKey = `${authorization.from}${NONCE_KEY_SEPARATOR}${authorization.nonce}`;
  if (usedNonces.has(nonceKey)) {
    return "Nonce already used";
  }

  // Check on-chain nonce status
  let onChainUsed: boolean;
  try {
    onChainUsed = await publicClient.readContract({
      address: contractAddress,
      abi: TRANSFER_WITH_AUTHORIZATION_ABI,
      functionName: "authorizationState",
      args: [authorization.from, authorization.nonce],
    });
  } catch (error) {
    throw new Error("Failed to check authorization status", {
      cause: error,
    });
  }

  if (onChainUsed) {
    return "Authorization already used on-chain";
  }

  return null;
}

// Reusable function to verify signature
async function verifySignature(
  authorization: eip3009Authorization,
  signature: Hex,
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  },
): Promise<boolean> {
  const types = EIP712_TYPES;

  const message: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: `0x${string}`;
  } = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(parseInt(authorization.validAfter)),
    validBefore: BigInt(parseInt(authorization.validBefore)),
    nonce: authorization.nonce,
  };

  // Verify the signature
  try {
    return await verifyTypedData({
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
}

// Reusable function to execute transaction
async function executeTransaction(
  authorization: eip3009Authorization,
  signature: Hex,
  contractAddress: `0x${string}`,
  walletClient: WalletClient,
  publicClient: PublicClient,
  usedNonces: Set<string>,
  chainId: number,
): Promise<x402SettleResponse> {
  const acct: Account | undefined = walletClient.account;
  if (!acct || acct.type !== "local") {
    return errorResponse(
      "Wallet client is not configured with a local account",
    );
  }

  const { v, r, s }: { v: number; r: Hex; s: Hex } = parseSignature(signature);

  const data: Hex = encodeFunctionData({
    abi: TRANSFER_WITH_AUTHORIZATION_ABI,
    functionName: "transferWithAuthorization",
    args: [
      authorization.from,
      authorization.to,
      BigInt(authorization.value),
      BigInt(parseInt(authorization.validAfter)),
      BigInt(parseInt(authorization.validBefore)),
      authorization.nonce,
      v,
      r,
      s,
    ],
  });

  // Build and send the transaction
  try {
    const request = await walletClient.prepareTransactionRequest({
      to: contractAddress,
      data,
      account: acct,
      chain: undefined,
    });

    const serializedTransaction: Hex =
      await walletClient.signTransaction(request);

    const txHash: Hex = await publicClient.sendRawTransaction({
      serializedTransaction,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status !== "success") {
      return errorResponse(`Transaction failed with status: ${receipt.status}`);
    }

    // Mark nonce as used
    const nonceKey = `${authorization.from}${NONCE_KEY_SEPARATOR}${authorization.nonce}`;
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
}

export async function createFacilitatorHandler(
  network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
  assetName: string,
): Promise<FacilitatorHandler> {
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

  const asset: `0x${string}` = assetInfo.address;
  const useForwarder: boolean =
    assetInfo.forwarder !== undefined && assetInfo.forwarderName !== undefined;
  const forwarderAddress: `0x${string}` | undefined = assetInfo.forwarder;
  const forwarderName: string | undefined = assetInfo.forwarderName;
  const forwarderVersion: string | undefined = assetInfo.forwarderVersion;
  const contractName: string = assetInfo.contractName;

  if (!isAddress(asset)) {
    throw new Error(`Invalid asset address: ${asset}`);
  }

  // Validate forwarder configuration if using forwarder
  if (useForwarder) {
    if (!forwarderAddress) throw new Error("Missing Forwarding Contract");
    if (!forwarderVersion) throw new Error("Missing Forwarding Version");
    if (!forwarderName) throw new Error("Missing Forwarding Name");
  }

  // Create contract configuration with cached domain
  const contractConfig = await createContractConfig(
    useForwarder,
    chainId,
    forwarderVersion,
    forwarderName,
    forwarderAddress,
    publicClient,
    asset,
    contractName,
  );

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
        maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
        // Provide EIP-712 domain parameters for client signing
        extra: {
          name: contractConfig.domain.name,
          version: contractConfig.domain.version,
          chainId: contractConfig.domain.chainId,
          verifyingContract: contractConfig.domain.verifyingContract,
        },
      }));
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ): Promise<x402SettleResponse | null> => {
    const tupleMatches = checkTuple(payment) as unknown;

    if (isValidationError(tupleMatches)) {
      return null; // Not for us, let another handler try
    }

    // For the exact scheme with EIP-3009, validate the authorization payload
    const payloadResult = x402ExactPayload(payment.payload);

    if (payloadResult instanceof type.errors) {
      return errorResponse(`Invalid payload: ${payloadResult.summary}`);
    }

    const {
      authorization,
      signature,
    }: { authorization: eip3009Authorization; signature: Hex } = payloadResult;

    // Validate authorization
    const authError = validateAuthorization(authorization, requirements);
    if (authError) {
      return errorResponse(authError);
    }

    // Check nonce usage
    const nonceError = await checkNonceUsage(
      authorization,
      usedNonces,
      publicClient,
      contractConfig.address,
    );
    if (nonceError) {
      return errorResponse(nonceError);
    }

    // Verify signature using cached domain
    const isValidSignature = await verifySignature(
      authorization,
      signature,
      contractConfig.domain,
    );

    if (!isValidSignature) {
      return errorResponse("Invalid signature");
    }

    // Verify contract supports EIP-712
    try {
      await publicClient.readContract({
        address: contractConfig.domain.verifyingContract,
        abi: TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: "DOMAIN_SEPARATOR",
      });
    } catch (cause) {
      throw new Error("Contract does not support EIP-712", { cause });
    }

    // Execute transaction
    return await executeTransaction(
      authorization,
      signature,
      contractConfig.address,
      walletClient,
      publicClient,
      usedNonces,
      chainId,
    );
  };

  return {
    getRequirements,
    handleSettle,
  };
}
