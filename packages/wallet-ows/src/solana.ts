import { PublicKey, VersionedTransaction } from "@solana/web3.js";
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

  const publicKey = new PublicKey(solanaAccount.address);

  const sign = async (tx: VersionedTransaction) => {
    const messageBytes = tx.message.serialize();
    const txHex = bytesToHex(messageBytes).slice(2);

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
    tx.addSignature(publicKey, signatureBytes);

    return tx;
  };

  return {
    network,
    publicKey,
    partiallySignTransaction: sign,
    updateTransaction: sign,
  };
}
