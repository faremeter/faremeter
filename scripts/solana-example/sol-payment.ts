import { Keypair } from "@solana/web3.js";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { createSolPaymentHandler } from "@faremeter/x402-solana";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/payer.json", "utf-8")),
  ),
);

const wallet = await createLocalWallet(keypair);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createSolPaymentHandler(wallet)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
console.log(await req.json());
