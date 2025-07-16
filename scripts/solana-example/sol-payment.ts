import { Keypair } from "@solana/web3.js";
import { createBasicPaymentHandler } from "@faremeter/x402-solana";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/payer.json", "utf-8")),
  ),
);
const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createBasicPaymentHandler(keypair)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
console.log(await req.json());
