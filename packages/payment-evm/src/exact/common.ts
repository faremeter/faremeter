import type { PublicClient, Hex } from "viem";

import { TRANSFER_WITH_AUTHORIZATION_ABI } from "./constants";

export async function generateDomain(
  publicClient: PublicClient,
  chainId: number,
  asset: Hex,
) {
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
    version: tokenVersion,
    chainId,
    verifyingContract: asset,
  };

  return domain;
}
