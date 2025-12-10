import { isPrivateKey, type ChainInfo } from "@faremeter/types/evm";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface EvmWallet {
  chain: ChainInfo;
  address: Hex;
  account: ReturnType<typeof privateKeyToAccount>;
}

export async function createLocalWallet(
  chain: ChainInfo,
  privateKey: string,
): Promise<EvmWallet> {
  if (!isPrivateKey(privateKey)) {
    throw new Error(
      `Invalid private key format. Expected 64-character hex string with '0x' prefix, got: ${privateKey.slice(0, 10)}...`,
    );
  }

  const account = privateKeyToAccount(privateKey);

  return {
    chain,
    address: account.address,
    account,
  };
}
