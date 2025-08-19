import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import Solana from "@ledgerhq/hw-app-solana/lib-es/Solana";
import { createTransport } from "./transport";
import type { LedgerSolanaWallet } from "./types";

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
