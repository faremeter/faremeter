import {
  address,
  getBase58Decoder,
  type Address,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import Solana from "@ledgerhq/hw-app-solana/lib-es/Solana";
import { createTransport } from "./transport";
import type { LedgerSolanaWallet } from "./types";

/**
 * Creates a Ledger hardware wallet interface for Solana.
 *
 * Connects to a Ledger device and returns a wallet that can sign
 * kit-native Solana transactions.
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

  const { address: addressBytes } = await solana.getAddress(derivationPath);
  const publicKey: Address = address(getBase58Decoder().decode(addressBytes));

  const signTransaction = async (tx: Transaction): Promise<Transaction> => {
    const signature = await solana.signTransaction(
      derivationPath,
      Buffer.from(tx.messageBytes),
    );

    const signatureBytes = new Uint8Array(signature.signature);
    if (signatureBytes.length !== 64) {
      throw new Error(
        `Ledger signature must be 64 bytes, got ${signatureBytes.length}`,
      );
    }

    return {
      ...tx,
      signatures: {
        ...tx.signatures,
        [publicKey]: signatureBytes as SignatureBytes,
      },
    };
  };

  return {
    network,
    publicKey,
    partiallySignTransaction: signTransaction,
    disconnect: async () => {
      await transport.close();
    },
  };
}
