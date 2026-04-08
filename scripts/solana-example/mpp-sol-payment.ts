import "dotenv/config";
import { logResponse } from "../logger";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { createMPPSolanaNativeChargeClient } from "@faremeter/payment-solana/charge";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

const { PAYER_KEYPAIR_PATH } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

const secretKey = Uint8Array.from(
  JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8")),
);

const wallet = await createLocalWallet("devnet", secretKey);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [],
  mppHandlers: [createMPPSolanaNativeChargeClient({ wallet })],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
await logResponse(req);
