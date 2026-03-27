import type { Hex } from "viem";
import type { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { evm } from "@faremeter/types";

/**
 * OWS wallet interface for Solana.
 *
 * XXX: OWS signing calls are synchronous/blocking under the hood.
 */
export interface OWSSolanaWallet {
  network: string;
  publicKey: PublicKey;
  partiallySignTransaction: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  updateTransaction: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
}

/**
 * OWS wallet interface for EVM chains.
 *
 * XXX: OWS signing calls are synchronous/blocking under the hood.
 */
export interface OWSEvmWallet {
  chain: evm.ChainInfo;
  address: Hex;
  account: {
    signTypedData: (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => Promise<Hex>;
  };
}

export type OWSWalletOpts = {
  walletNameOrId: string;
  passphrase: string;
  vaultPath?: string;
};
