/**
 * @title Solana Wallet Package
 * @sidebarTitle Wallet Solana
 * @description Local wallet creation for Solana using keypairs
 * @packageDocumentation
 */
import { getLogger } from "@faremeter/logs";
import {
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { partiallySignTransaction } from "@solana/transactions";

/** Duck-type for @solana/web3.js v1 Keypair. */
interface KeypairLike {
  secretKey: Uint8Array;
  publicKey: { toBase58(): string };
}

export type LocalWalletInput = Uint8Array | KeyPairSigner | KeypairLike;

let warnedKeypair = false;

/**
 * Creates a local Solana wallet from a 64-byte secret key, a kit
 * `KeyPairSigner`, or a v1 `Keypair` for signing kit-native
 * transactions.
 *
 * @param network - Network identifier (e.g., "mainnet-beta", "devnet").
 * @param input - A 64-byte secret key, kit `KeyPairSigner`, or v1 `Keypair`.
 * @returns A wallet object that can partially sign kit `Transaction`s.
 */
export async function createLocalWallet(
  network: string,
  input: LocalWalletInput,
) {
  let signer: KeyPairSigner;
  if (input instanceof Uint8Array) {
    signer = await createKeyPairSignerFromBytes(input);
  } else if ("address" in input && "keyPair" in input) {
    signer = input as KeyPairSigner;
  } else if ("secretKey" in input && "publicKey" in input) {
    if (!warnedKeypair) {
      const logger = await getLogger(["faremeter", "wallet-solana"]);
      logger.warning(
        "Passing a @solana/web3.js Keypair is deprecated — " +
          "use a Uint8Array secret key or @solana/kit " +
          "KeyPairSigner instead. " +
          "v1 compatibility will be removed in a future release.",
      );
      warnedKeypair = true;
    }
    signer = await createKeyPairSignerFromBytes(
      (input as KeypairLike).secretKey,
    );
  } else {
    throw new TypeError("expected a Uint8Array, KeyPairSigner, or Keypair");
  }

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
