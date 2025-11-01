import "dotenv/config";
import { logResponse } from "../logger";
import { createPayer } from "@faremeter/solana";

const { PAYER_KEYPAIR_PATH } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

const payer = createPayer({ networks: ["devnet"] });
await payer.addLocalWallet(PAYER_KEYPAIR_PATH);

const req = await payer.fetch("http://127.0.0.1:3000/protected");

await logResponse(req);
