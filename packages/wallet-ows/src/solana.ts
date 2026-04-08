import {
  address,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  type Address,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { bytesToHex, hexToBytes, isHex } from "viem";
import {
  getWallet as getWalletOWS,
  signTransaction,
} from "@open-wallet-standard/core";
import type { OWSSolanaWallet, OWSWalletOpts } from "./types";
import { logger } from "./logger";

/**
 * Creates an OWS-backed Solana wallet.
 *
 * Uses the Open Wallet Standard vault for transaction signing.
 * The passphrase is closed over and used for each signing operation.
 *
 * XXX - OWS signing calls are synchronous and block the event loop.
 * Consider wrapping in worker_threads if this becomes a bottleneck.
 *
 * @param network - Solana network identifier (e.g., "mainnet-beta", "devnet").
 * @param opts - OWS wallet options (wallet name/ID, passphrase, vault path).
 * @param getWallet - Optional wallet lookup function for testability.
 * @returns A Solana wallet that delegates signing to OWS.
 */
export function createOWSSolanaWallet(
  network: string,
  opts: OWSWalletOpts,
  getWallet: typeof getWalletOWS = getWalletOWS,
): OWSSolanaWallet {
  const { walletNameOrId, passphrase, vaultPath } = opts;

  const walletInfo = getWallet(walletNameOrId, vaultPath);
  const solanaAccount = walletInfo.accounts.find((a) =>
    a.chainId.startsWith("solana"),
  );

  if (!solanaAccount) {
    const msg = `No Solana account found in OWS wallet "${walletNameOrId}"`;
    logger.error(msg);
    throw new Error(msg);
  }

  const publicKey: Address = address(solanaAccount.address);

  const sign = async (tx: Transaction): Promise<Transaction> => {
    // OWS signs the message portion of a full wire-format transaction.
    // Serialize to wire bytes first (matching the v1 `tx.serialize()`
    // behavior), then hand the hex to OWS.
    const wireBase64 = getBase64EncodedWireTransaction(tx);
    const wireBytes = getBase64Encoder().encode(wireBase64);
    const txHex = bytesToHex(new Uint8Array(wireBytes)).slice(2);

    const result = signTransaction(
      walletNameOrId,
      "solana",
      txHex,
      passphrase,
      undefined,
      vaultPath,
    );

    const sig = result.signature;
    const sigHex = sig.startsWith("0x") ? sig : `0x${sig}`;
    if (!isHex(sigHex) || sigHex.length < 4 || sigHex.length % 2 !== 0) {
      throw new Error(
        `OWS returned invalid hex signature: ${result.signature}`,
      );
    }
    const signatureBytes = hexToBytes(sigHex);
    if (signatureBytes.length !== 64) {
      throw new Error(
        `OWS signature must be 64 bytes, got ${signatureBytes.length}`,
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
    partiallySignTransaction: sign,
  };
}
