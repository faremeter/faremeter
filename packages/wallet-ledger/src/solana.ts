import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import Solana from "@ledgerhq/hw-app-solana/lib-es/Solana";
import { createTransport } from "./transport";
import type { LedgerSolanaWallet } from "./types";

/**
 * Creates a Ledger hardware wallet interface for Solana.
 *
 * Connects to a Ledger device and returns a wallet that can sign
 * Solana versioned transactions.
 *
 * @param network - Solana network identifier (e.g., "mainnet-beta", "devnet").
 * @param derivationPath - BIP-44 derivation path (e.g., "44'/501'/0'").
 * @returns A Ledger Solana wallet interface.
 */
export async function createLedgerSolanaWallet(
  network: string,
  derivationPath: string,
): Promise<LedgerSolanaWallet> {
  const transport = await createTransport();
  const solana = new Solana(transport);

  const { address } = await solana.getAddress(derivationPath);
  const publicKey = new PublicKey(address);

  return {
    network,
    publicKey,
    updateTransaction: async (tx: VersionedTransaction) => {
      const message = tx.message.serialize();

      const signature = await solana.signTransaction(
        derivationPath,
        Buffer.from(message),
      );

      tx.addSignature(publicKey, signature.signature);

      return tx;
    },
    disconnect: async () => {
      await transport.close();
    },
  };
}
