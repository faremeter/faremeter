import {
  createWalletClient,
  http,
  type Hex,
  type Chain,
  type LocalAccount,
  type TransactionSerializable,
  type TypedDataDomain,
  hashDomain,
  hashStruct,
} from "viem";
import { baseSepolia, mainnet, sepolia } from "viem/chains";
import Eth from "@ledgerhq/hw-app-eth/lib-es/Eth";
import { createTransport } from "./transport";
import type { LedgerEvmWallet } from "./types";

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

export async function createLedgerEvmWallet(
  network: string,
  derivationPath: string,
): Promise<LedgerEvmWallet> {
  const config = NETWORK_CONFIGS.get(network);
  if (!config) {
    throw new Error(
      `Unsupported network: ${network}. Supported networks: ${Array.from(NETWORK_CONFIGS.keys()).join(", ")}`,
    );
  }

  const transport = await createTransport();
  const eth = new Eth(transport);

  const { address } = await eth.getAddress(derivationPath);
  const formattedAddress = (
    address.startsWith("0x") ? address : `0x${address}`
  ).toLowerCase() as Hex;

  const ledgerAccount: LocalAccount = {
    address: formattedAddress,
    publicKey: formattedAddress,
    type: "local",
    source: "custom",

    signMessage: async ({ message }) => {
      let messageToSign: string;
      if (typeof message === "string") {
        messageToSign = Buffer.from(message).toString("hex");
      } else if (message && typeof message === "object" && "raw" in message) {
        const raw = message.raw;
        messageToSign =
          typeof raw === "string"
            ? raw.slice(2)
            : Buffer.from(raw).toString("hex");
      } else {
        messageToSign = Buffer.from(String(message)).toString("hex");
      }

      const result = await eth.signPersonalMessage(
        derivationPath,
        messageToSign,
      );
      const signature =
        `0x${result.r}${result.s}${result.v.toString(16).padStart(2, "0")}` as Hex;
      return signature;
    },

    signTransaction: async (transaction: TransactionSerializable) => {
      const tx = {
        to: transaction.to,
        value: transaction.value
          ? `0x${transaction.value.toString(16)}`
          : "0x0",
        data: transaction.data || "0x",
        nonce: transaction.nonce
          ? `0x${transaction.nonce.toString(16)}`
          : "0x0",
        gasLimit: transaction.gas
          ? `0x${transaction.gas.toString(16)}`
          : "0x5208",
        gasPrice: transaction.gasPrice
          ? `0x${transaction.gasPrice.toString(16)}`
          : undefined,
        maxFeePerGas: transaction.maxFeePerGas
          ? `0x${transaction.maxFeePerGas.toString(16)}`
          : undefined,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
          ? `0x${transaction.maxPriorityFeePerGas.toString(16)}`
          : undefined,
        chainId: config.chain.id,
      };

      const result = await eth.signTransaction(
        derivationPath,
        JSON.stringify(tx),
      );
      const signature = `0x${result.r}${result.s}${result.v}` as Hex;
      return signature;
    },

    signTypedData: async (parameters) => {
      const { domain, types, primaryType, message } = parameters as unknown as {
        domain?: TypedDataDomain;
        types: Record<string, { name: string; type: string }[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };

      try {
        // Use EIP-712 hashed message approach. This calculates the domain
        // separator and message hash separately and sends them to the Ledger
        // for signing.

        // Build types with EIP712Domain
        const typesWithDomain = {
          EIP712Domain: [
            ...(domain?.name ? [{ name: "name", type: "string" }] : []),
            ...(domain?.version ? [{ name: "version", type: "string" }] : []),
            ...(domain?.chainId ? [{ name: "chainId", type: "uint256" }] : []),
            ...(domain?.verifyingContract
              ? [{ name: "verifyingContract", type: "address" }]
              : []),
          ],
          ...types,
        };

        // Calculate hashes using viem
        const domainSeparator = hashDomain({
          domain: domain || {},
          types: typesWithDomain,
        });

        // types without domain for message hash
        const messageHash = hashStruct({
          data: message,
          primaryType,
          types,
        });

        console.log("\nEIP-712 hashes calculated:");
        console.log("  Domain separator:", domainSeparator);
        console.log("  Message hash:", messageHash);
        console.log(
          "\nPlease approve the transaction on your Ledger device...",
        );

        const result = await eth.signEIP712HashedMessage(
          derivationPath,
          domainSeparator.slice(2),
          messageHash.slice(2),
        );

        const signature =
          `0x${result.r}${result.s}${result.v.toString(16).padStart(2, "0")}` as Hex;
        return signature;
      } catch (error) {
        console.error("EIP-712 signing failed:", error);
        throw error;
      }
    },
  };

  const client = createWalletClient({
    account: ledgerAccount,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  return {
    network,
    address: formattedAddress,
    client,
    signTransaction: async (tx: TransactionSerializable) => {
      return await ledgerAccount.signTransaction(tx);
    },
    signTypedData: async (params) => {
      return await ledgerAccount.signTypedData(params);
    },
    disconnect: async () => {
      await transport.close();
    },
  };
}
