import { generateRequirementsMatcher } from "@faremeter/types/x402";
import { lookupX402Network } from "@faremeter/info/solana";

export const x402Scheme = "exact";

export function generateMatcher(network: string, asset: string) {
  const caip2Network = lookupX402Network(network);

  return generateRequirementsMatcher([x402Scheme], [caip2Network], [asset]);
}
