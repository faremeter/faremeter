import { isPrivateKey, type ChainInfo } from "@faremeter/types/evm";
import { createWalletClient, http, type WalletClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface EvmWallet {
  chain: ChainInfo;
  address: Hex;
  client: WalletClient;
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
  const client = createWalletClient({
    account,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  return {
    chain,
    address: account.address,
    client,
    account,
  };
}
