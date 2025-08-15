import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLocalWallet } from "@faremeter/wallet-solana";
import {
  createPaymentHandler,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";
import { clusterApiUrl } from "@solana/web3.js";

const { PAYER_KEYPAIR_PATH, ASSET_ADDRESS } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

if (!ASSET_ADDRESS) {
  throw new Error("ASSET_ADDRESS must point at an SPL Token address");
}

const network = "devnet";
const x402Network = lookupX402Network(network);
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8"))),
);

const connection = new Connection(clusterApiUrl(network));

const mint = new PublicKey(ASSET_ADDRESS);
const wallet = await createLocalWallet(x402Network, keypair);
const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet, mint, connection)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");

console.log(await req.json());
