import "dotenv/config";
import { logger, logResponse } from "../logger";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { bytesToHex } from "viem";
import { createOWSSolanaWallet } from "@faremeter/wallet-ows";
import {
  importWalletPrivateKey,
  deleteWallet,
} from "@open-wallet-standard/core";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import { createPaymentHandler } from "@faremeter/payment-solana/exact";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const { PAYER_KEYPAIR_PATH } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

const network = "devnet";
const WALLET_NAME = `ows-test-${Date.now()}`;

const splTokenName = "USDC";
const usdcInfo = lookupKnownSPLToken(network, splTokenName);
if (!usdcInfo) {
  throw new Error(`couldn't look up SPLToken ${splTokenName} on ${network}!`);
}

// Import the existing devnet payer keypair into a temporary OWS wallet.
// The private key is read from the keypair file, passed to OWS for import,
// then the local reference is discarded. OWS encrypts it in the vault.
const keypairBytes = Uint8Array.from(
  JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8")),
);
const secretKey = keypairBytes.slice(0, 32);
const privateKeyHex = bytesToHex(secretKey).slice(2);

importWalletPrivateKey(WALLET_NAME, privateKeyHex, "", undefined, "solana");

// Verify the OWS wallet derived the same address as the keypair file.
const expectedAddress =
  Keypair.fromSecretKey(keypairBytes).publicKey.toBase58();
const wallet = createOWSSolanaWallet(network, {
  walletNameOrId: WALLET_NAME,
  passphrase: "",
});

if (wallet.publicKey.toBase58() !== expectedAddress) {
  deleteWallet(WALLET_NAME);
  throw new Error(
    `OWS derived address ${wallet.publicKey.toBase58()} does not match expected ${expectedAddress}`,
  );
}

logger.info(
  `OWS wallet "${WALLET_NAME}" address: ${wallet.publicKey.toBase58()}`,
);

const connection = new Connection(clusterApiUrl(network));
const mint = new PublicKey(usdcInfo.address);

try {
  const fetchWithPayer = wrapFetch(fetch, {
    handlers: [createPaymentHandler(wallet, mint, connection)],
  });

  const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
  await logResponse(req);
} finally {
  deleteWallet(WALLET_NAME);
  logger.info(`Cleaned up OWS wallet "${WALLET_NAME}"`);
}
