import { generateRequirementsMatcher } from "@faremeter/types/x402";
import {
  lookupX402Network,
  type SolanaCAIP2Network,
} from "@faremeter/info/solana";

export const FLEX_SCHEME = "flex";

export function generateMatcher(
  network: string | SolanaCAIP2Network,
  asset: string,
) {
  const solanaNetwork = lookupX402Network(network);

  return generateRequirementsMatcher(
    [FLEX_SCHEME],
    [solanaNetwork.caip2],
    [asset],
  );
}
