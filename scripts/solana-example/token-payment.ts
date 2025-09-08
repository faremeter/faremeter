import "dotenv/config";
import { logResponse } from "../logger";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { createPaymentHandler } from "@faremeter/x-solana-settlement";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const { PAYER_KEYPAIR_PATH, ASSET_ADDRESS } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

if (!ASSET_ADDRESS) {
  throw new Error("ASSET_ADDRESS must point at an SPL Token address");
}

const network = "devnet";
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8"))),
);

const mint = new PublicKey(ASSET_ADDRESS);
const wallet = await createLocalWallet(network, keypair);
const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet, mint)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");

await logResponse(req);
