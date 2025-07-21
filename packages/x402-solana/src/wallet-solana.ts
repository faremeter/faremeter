import { Keypair, type VersionedTransaction } from "@solana/web3.js";

export async function createLocalWallet(keypair: Keypair) {
  return {
    publicKey: keypair.publicKey,
    updateTransaction: async (tx: VersionedTransaction) => {
      tx.sign([keypair]);
      return tx;
    },
  };
}
