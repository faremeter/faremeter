import type { Keypair, VersionedTransaction } from "@solana/web3.js";

export async function createLocalWallet(network: string, keypair: Keypair) {
  return {
    network,
    publicKey: keypair.publicKey,
    updateTransaction: async (tx: VersionedTransaction) => {
      tx.sign([keypair]);
      return tx;
    },
  };
}

export type LocalWallet = Awaited<ReturnType<typeof createLocalWallet>>;
