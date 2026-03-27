import "dotenv/config";
import { logger, logResponse } from "../logger";
import { createOWSEvmWallet } from "@faremeter/wallet-ows";
import {
  importWalletPrivateKey,
  deleteWallet,
} from "@open-wallet-standard/core";
import { createPaymentHandler } from "@faremeter/payment-evm/exact";
import { wrap as wrapFetch } from "@faremeter/fetch";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const { EVM_PRIVATE_KEY } = process.env;

if (!EVM_PRIVATE_KEY) {
  throw new Error("EVM_PRIVATE_KEY must be set in your environment");
}

const WALLET_NAME = `ows-evm-test-${Date.now()}`;

// Import the existing EVM private key into a temporary OWS wallet.
// The key is passed to OWS for import, then the vault encrypts it.
const bareKey = EVM_PRIVATE_KEY.startsWith("0x")
  ? EVM_PRIVATE_KEY.slice(2)
  : EVM_PRIVATE_KEY;

importWalletPrivateKey(WALLET_NAME, bareKey, "", undefined, "evm");

// Verify the OWS wallet derived the same address as the private key.
const expectedAddress = privateKeyToAccount(EVM_PRIVATE_KEY as Hex).address;
const wallet = createOWSEvmWallet(baseSepolia, {
  walletNameOrId: WALLET_NAME,
  passphrase: "",
});

if (wallet.address !== expectedAddress.toLowerCase()) {
  deleteWallet(WALLET_NAME);
  throw new Error(
    `OWS derived address ${wallet.address} does not match expected ${expectedAddress}`,
  );
}

logger.info(`OWS wallet "${WALLET_NAME}" address: ${wallet.address}`);

// Parse command line arguments
const args = process.argv.slice(2);
const port = args[0] ?? "4021";
const endpoint = args[1] ?? "weather";
const url = `http://localhost:${port}/${endpoint}`;

try {
  const fetchWithPayer = wrapFetch(fetch, {
    handlers: [createPaymentHandler(wallet)],
  });

  logger.info(`Making payment request to ${url}...`);
  const req = await fetchWithPayer(url);
  await logResponse(req);
} finally {
  deleteWallet(WALLET_NAME);
  logger.info(`Cleaned up OWS wallet "${WALLET_NAME}"`);
}
