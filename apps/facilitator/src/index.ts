import "dotenv/config";
import { default as express } from "express";
import { createFacilitatorHandler as createSolanaHandler } from "@faremeter/x-solana-settlement/facilitator";
import {
  createFacilitatorHandler as createFacilitatorHandlerExact,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import { createFacilitatorHandler as createEvmHandler } from "@faremeter/payment-evm";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/kit";
import {
  createPublicClient,
  http,
  createWalletClient,
  isAddress,
  isHex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createFacilitatorRouter } from "./routes";
import fs from "fs";
import type { FacilitatorHandler } from "@faremeter/types";

const {
  ADMIN_KEYPAIR_PATH,
  ASSET_ADDRESS,
  EVM_RECEIVING_ADDRESS,
  EVM_PRIVATE_KEY,
  EVM_RPC_URL,
  EVM_ASSET_ADDRESS,
} = process.env;

const handlers: FacilitatorHandler[] = [];

// Solana configuration
if (ADMIN_KEYPAIR_PATH && ASSET_ADDRESS) {
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))),
  );
  const network = "devnet";
  const apiUrl = clusterApiUrl(network);
  const connection = new Connection(apiUrl, "confirmed");
  const rpc = createSolanaRpc(apiUrl);
  const mint = new PublicKey(ASSET_ADDRESS);

  // Add Solana handlers
  handlers.push(
    // SOL
    createSolanaHandler(network, connection, adminKeypair),
    // SPL Token
    createSolanaHandler(network, connection, adminKeypair, mint),
    // SPL Token with exact scheme
    createFacilitatorHandlerExact(
      lookupX402Network(network),
      rpc,
      adminKeypair,
      mint,
    ),
  );
  console.log("Solana handlers configured for devnet");
}

// EVM configuration (Base Sepolia)
if (EVM_RECEIVING_ADDRESS && EVM_PRIVATE_KEY) {
  // Validate private key format
  if (!isHex(EVM_PRIVATE_KEY) || EVM_PRIVATE_KEY.length !== 66) {
    console.error(
      "ERROR: EVM_PRIVATE_KEY must be a 32-byte hex string (64 chars + 0x prefix)",
    );
    process.exit(1);
  }

  // Validate receiving address format
  if (!isAddress(EVM_RECEIVING_ADDRESS)) {
    console.error(
      "ERROR: EVM_RECEIVING_ADDRESS must be a valid Ethereum address",
    );
    process.exit(1);
  }

  const transport = http(EVM_RPC_URL ?? "https://sepolia.base.org");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport,
  });

  const account = privateKeyToAccount(EVM_PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport,
  });

  handlers.push(
    createEvmHandler(
      "base-sepolia",
      // @ts-expect-error - TypeScript version mismatch: x-solana-settlement uses TS 5.5.4, needs update to 5.8.3
      publicClient,
      walletClient,
      EVM_RECEIVING_ADDRESS as `0x${string}`,
      EVM_ASSET_ADDRESS,
    ),
  );
  console.log("EVM handler configured for Base Sepolia");
}

if (handlers.length === 0) {
  console.error(
    "ERROR: No payment handlers configured.\n" +
      "   Set ADMIN_KEYPAIR_PATH and ASSET_ADDRESS for Solana\n" +
      "   Set EVM_RECEIVING_ADDRESS and EVM_PRIVATE_KEY for EVM",
  );
  process.exit(1);
}

const listenPort = process.env.PORT ? parseInt(process.env.PORT) : 4000;

const app = express();
app.use(
  "/",
  createFacilitatorRouter({
    handlers,
  }),
);

app.listen(listenPort, () => {
  console.log(`Facilitator server listening on port ${listenPort}`);
  console.log(`Active payment handlers: ${handlers.length}`);
  if (ADMIN_KEYPAIR_PATH && ASSET_ADDRESS) {
    console.log("   - Solana (SOL & SPL Token)");
  }
  if (EVM_RECEIVING_ADDRESS && EVM_PRIVATE_KEY) {
    console.log("   - EVM (Base Sepolia)");
  }
});
