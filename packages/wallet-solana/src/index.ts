/**
 * @title Solana Wallet Package
 * @sidebarTitle Wallet Solana
 * @description Local wallet creation for Solana using keypairs
 * @packageDocumentation
 */
import {
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { partiallySignTransaction } from "@solana/transactions";

export type LocalWalletInput = Uint8Array | KeyPairSigner;

/**
 * Creates a local Solana wallet from a 64-byte secret key (or an existing
 * {@link KeyPairSigner}) for signing kit-native transactions.
 *
 * @param network - Network identifier (e.g., "mainnet-beta", "devnet").
 * @param input - Either a 64-byte secret key or an existing kit `KeyPairSigner`.
 * @returns A wallet object that can partially sign kit `Transaction`s.
 */
export async function createLocalWallet(
  network: string,
  input: LocalWalletInput,
) {
  const signer: KeyPairSigner =
    input instanceof Uint8Array
      ? await createKeyPairSignerFromBytes(input)
      : input;

  const publicKey: Address = signer.address;

  const signTransaction = async (tx: Transaction): Promise<Transaction> => {
    return partiallySignTransaction([signer.keyPair], tx);
  };

  return {
    network,
    publicKey,
    partiallySignTransaction: signTransaction,
  };
}

/**
 * Type representing a local Solana wallet created by {@link createLocalWallet}.
 */
export type LocalWallet = Awaited<ReturnType<typeof createLocalWallet>>;
