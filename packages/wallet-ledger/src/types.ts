import type {
  Hex,
  WalletClient,
  TransactionSerializable,
  TypedDataDefinition,
} from "viem";
import type { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type Transport from "@ledgerhq/hw-transport";

export interface LedgerEvmWallet {
  network: string;
  address: Hex;
  client: WalletClient;
  signTransaction: (tx: TransactionSerializable) => Promise<Hex>;
  signTypedData: (params: TypedDataDefinition) => Promise<Hex>;
  disconnect: () => Promise<void>;
}

export interface LedgerSolanaWallet {
  network: string;
  publicKey: PublicKey;
  updateTransaction: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  disconnect: () => Promise<void>;
}

export interface LedgerTransportWrapper {
  transport: Transport;
  close: () => Promise<void>;
}
