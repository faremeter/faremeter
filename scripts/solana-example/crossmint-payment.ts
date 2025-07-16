import { createCrossmintPaymentHandler } from "@faremeter/x402-solana";
import { wrap as wrapFetch } from "@faremeter/fetch";

// Address of your crossmint wallet
const crossmintWallet = process.env.CROSSMINT_WALLET;
const crossmintApi = process.env.CROSSMINT_API_KEY;

if (!crossmintWallet || !crossmintApi) {
  throw new Error(
    "Missing required environment variables: CROSSMINT_WALLET and CROSSMINT_API_KEY",
  );
}

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createCrossmintPaymentHandler(crossmintApi, crossmintWallet)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
console.log(await req.json());
