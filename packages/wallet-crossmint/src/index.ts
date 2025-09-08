import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  createCrossmint,
  CrossmintWallets,
  SolanaWallet,
} from "@crossmint/wallets-sdk";

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
    signer: {
      type: "api-key",
    },
  });

  const solanaWallet = SolanaWallet.from(wallet);
  const publicKey = new PublicKey(solanaWallet.address);

  return {
    network,
    publicKey,
    sendTransaction: async (tx: VersionedTransaction) => {
      const solTx = await solanaWallet.sendTransaction({
        transaction: tx as any, // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      });

      return solTx.hash;
    },
  };
}
