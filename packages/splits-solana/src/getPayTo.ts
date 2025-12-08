import type { Address } from "@solana/kit";
import { labelToSeed, deriveSplitConfig } from "@cascade-fyi/splits-sdk/solana";

/**
 * Derive the splitConfig PDA address to use as `payTo`.
 *
 * Pure function - no RPC calls.
 *
 * @param authority - The split authority (merchant signer address)
 * @param mint - Token mint address (e.g., USDC)
 * @param label - Human-readable label (e.g., "product-123")
 * @returns The splitConfig PDA address
 */
export async function getPayTo(
  authority: Address,
  mint: Address,
  label: string,
): Promise<Address> {
  const seed = labelToSeed(label);
  return deriveSplitConfig(authority, mint, seed);
}
