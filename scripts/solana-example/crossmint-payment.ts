import "dotenv/config";
import { logger } from "../logger";
import { createCrossmintWallet } from "@faremeter/wallet-crossmint";
import { createPaymentHandler } from "@faremeter/x-solana-settlement";
import { wrap as wrapFetch } from "@faremeter/fetch";

// Address of your crossmint wallet
const crossmintWallet = process.env.CROSSMINT_WALLET;
const crossmintApi = process.env.CROSSMINT_API_KEY;

if (!crossmintWallet || !crossmintApi) {
  throw new Error(
    "Missing required environment variables: CROSSMINT_WALLET and CROSSMINT_API_KEY",
  );
}

const wallet = await createCrossmintWallet(
  "devnet",
  crossmintApi,
  crossmintWallet,
);
const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
logger.info(await req.json());
