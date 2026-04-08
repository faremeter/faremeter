import "dotenv/config";
import { logResponse } from "../logger";
import { address } from "@solana/kit";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import { createMPPSolanaChargeClient } from "@faremeter/payment-solana/charge";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const { PAYER_KEYPAIR_PATH } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

const network = "devnet";

const usdcInfo = lookupKnownSPLToken(network, "USDC");
if (!usdcInfo) {
  throw new Error("couldn't look up USDC on devnet");
}

const secretKey = Uint8Array.from(
  JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8")),
);

const wallet = await createLocalWallet(network, secretKey);
const mint = address(usdcInfo.address);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [],
  mppHandlers: [createMPPSolanaChargeClient({ wallet, mint })],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
await logResponse(req);
