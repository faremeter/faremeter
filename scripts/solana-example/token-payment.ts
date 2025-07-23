import { Keypair, PublicKey } from "@solana/web3.js";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { createPaymentHandler } from "@faremeter/x402-solana";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const network = "devnet";
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/payer.json", "utf-8")),
  ),
);

const mint = new PublicKey("Hxtm6jXVcA9deMFxJRvMkHewhYJHxCpqsLvH9d1bvxBP");
const wallet = await createLocalWallet(network, keypair);
const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet, mint)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");

console.log(await req.json());
