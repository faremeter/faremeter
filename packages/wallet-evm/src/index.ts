import {
  createWalletClient,
  http,
  type WalletClient,
  type Hex,
  type Chain,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, mainnet, sepolia } from "viem/chains";

interface NetworkConfig {
  chain: Chain;
  rpcUrl: string;
}

const NETWORK_CONFIGS = new Map<string, NetworkConfig>([
  [
    "base-sepolia",
    {
      chain: baseSepolia,
      rpcUrl: "https://sepolia.base.org",
    },
  ],
  [
    "ethereum",
    {
      chain: mainnet,
      rpcUrl: "https://ethereum-rpc.publicnode.com",
    },
  ],
  [
    "sepolia",
    {
      chain: sepolia,
      rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    },
  ],
]);

export function lookupNetworkConfig(network: string) {
  return NETWORK_CONFIGS.get(network);
}

export function isValidPrivateKey(privateKey: string): privateKey is Hex {
  return isHex(privateKey) && privateKey.length == 66;
}

export interface EvmWallet {
  network: string;
  address: Hex;
  client: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
}

export async function createLocalWallet(
  network: string,
  privateKey: string,
): Promise<EvmWallet> {
  const config = lookupNetworkConfig(network);
  if (!config) {
    throw new Error(
      `Unsupported network: ${network}. Supported networks: ${Array.from(NETWORK_CONFIGS.keys()).join(", ")}`,
    );
  }

  if (!isValidPrivateKey(privateKey)) {
    throw new Error(
      `Invalid private key format. Expected 64-character hex string with '0x' prefix, got: ${privateKey.slice(0, 10)}...`,
    );
  }

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  return {
    network,
    address: account.address,
    client,
    account,
  };
}
