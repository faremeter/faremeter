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

/**
 * Translate a CAIP-2 network identifier to legacy format.
 * Handles both EVM and Solana networks.
 * Returns the input unchanged if no mapping exists (may not be a known
 * CAIP-2 network, or may already be legacy).
 */
export function translateNetworkToLegacy(network: string): string {
  const evmLegacy = evm.caip2ToLegacyName(network);
  if (evmLegacy) return evmLegacy;

  const solanaLegacy = solana.caip2ToLegacyNetworkIds(network);
  const firstSolanaLegacy = solanaLegacy?.[0];
  if (firstSolanaLegacy) return firstSolanaLegacy;

  return network;
}
