/**
 * @title Crossmint Wallet Package
 * @sidebarTitle Wallet Crossmint
 * @description Crossmint custodial wallet integration for Solana
 * @packageDocumentation
 */
import {
  address,
  getBase64EncodedWireTransaction,
  type Address,
  type Transaction,
} from "@solana/kit";
import {
  createCrossmint,
  CrossmintWallets,
  SolanaWallet,
} from "@crossmint/wallets-sdk";

// NOTE: @crossmint/wallets-sdk still transitively pulls @solana/web3.js v1
// (its internal types reference VersionedTransaction). Crossmint owns that
// chain, not us — we only pass a base64-encoded wire transaction via the
// `serializedTransaction` input, which keeps Faremeter code free of any
// direct v1 dependency. See FMTR-391 for quarantine rationale.

/**
 * Creates a Crossmint custodial wallet for Solana.
 *
 * Uses the Crossmint Wallets SDK to sign and send transactions via
 * API key authentication.
 *
 * @param network - Solana network identifier.
 * @param crossmintApiKey - Crossmint API key for authentication.
 * @param crossmintWalletAddress - Address of the Crossmint-managed wallet.
 * @returns A wallet object that can send kit-native Solana transactions.
 */
export async function createCrossmintWallet(
  network: string,
  crossmintApiKey: string,
  crossmintWalletAddress: string,
) {
  const crossmint = createCrossmint({
    apiKey: crossmintApiKey,
  });
  const crossmintWallets = CrossmintWallets.from(crossmint);
  const wallet = await crossmintWallets.getWallet(crossmintWalletAddress, {
    chain: "solana",
  });
  await wallet.useSigner({ type: "api-key" });

  const solanaWallet = SolanaWallet.from(wallet);
  const publicKey: Address = address(solanaWallet.address);

  return {
    network,
    publicKey,
    sendTransaction: async (tx: Transaction): Promise<string> => {
      const serializedTransaction = getBase64EncodedWireTransaction(tx);
      const solTx = await solanaWallet.sendTransaction({
        serializedTransaction,
      });

      return solTx.hash;
    },
  };
}
