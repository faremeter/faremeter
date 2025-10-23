import { type } from "arktype";
import { caseInsensitiveLiteral } from "@faremeter/types";
import { lookupX402Network } from "@faremeter/info/solana";

export const x402Scheme = "exact";

export function generateMatcher(network: string, asset: string) {
  const matchTuple = type({
    scheme: caseInsensitiveLiteral(x402Scheme),
    network: caseInsensitiveLiteral(lookupX402Network(network)),
  });
  const matchTupleAndAsset = matchTuple.and({
    asset: caseInsensitiveLiteral(asset),
  });

  return {
    matchTuple,
    matchTupleAndAsset,
  };
}
