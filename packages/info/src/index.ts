import * as solana from "./solana";
import * as evm from "./evm";

export { solana, evm };

/**
 * Normalize a legacy network identifier to CAIP-2 format.
 * Handles both EVM and Solana networks.
 * Returns the input unchanged if no mapping exists (may already be CAIP-2
 * or an unknown network).
 */
export function normalizeNetworkId(network: string): string {
  if (network.startsWith("eip155:")) return network;
  const evmCaip2 = evm.legacyNameToCAIP2(network);
  if (evmCaip2) return evmCaip2;

  if (network.startsWith("solana:")) return network;
  const solanaCaip2 = solana.legacyNetworkIdToCAIP2(network);
  if (solanaCaip2) return solanaCaip2;

  return network;
}
