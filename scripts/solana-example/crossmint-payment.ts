import "dotenv/config";
import { logResponse } from "../logger";
import { createCrossmintWallet } from "@faremeter/wallet-crossmint";
import { createPaymentHandler } from "@faremeter/payment-solana/exactSettlement";
import { wrap as wrapFetch } from "@faremeter/fetch";
import { PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import { lookupKnownSPLToken } from "@faremeter/info/solana";

// Address of your crossmint wallet
const crossmintWallet = process.env.CROSSMINT_WALLET;
const crossmintApi = process.env.CROSSMINT_API_KEY;

if (!crossmintWallet || !crossmintApi) {
  throw new Error(
    "Missing required environment variables: CROSSMINT_WALLET and CROSSMINT_API_KEY",
  );
}

const network = "mainnet-beta";

const splTokenName = "USDC";

const usdcInfo = lookupKnownSPLToken(network, splTokenName);
if (!usdcInfo) {
  throw new Error(`couldn't look up SPLToken ${splTokenName} on ${network}!`);
}

console.log("using USDC info", usdcInfo);

const connection = new Connection(clusterApiUrl(network));

const mint = new PublicKey(usdcInfo.address);

const wallet = await createCrossmintWallet(
  network,
  crossmintApi,
  crossmintWallet,
);
const fetchWithPayer = wrapFetch(fetch, {
  handlers: [
    createPaymentHandler(wallet, mint, connection, {
      token: {
        allowOwnerOffCurve: true,
      },
    }),
  ],
  retryCount: 0,
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
await logResponse(req);
