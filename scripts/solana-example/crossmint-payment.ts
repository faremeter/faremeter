import "dotenv/config";
import { logResponse } from "../logger";
import { address, createSolanaRpc } from "@solana/kit";
import { createCrossmintWallet } from "@faremeter/wallet-crossmint";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import { createPaymentHandler } from "@faremeter/payment-solana/exact";
import { wrap as wrapFetch } from "@faremeter/fetch";

// Address of your crossmint wallet
const crossmintWallet = process.env.CROSSMINT_WALLET;
const crossmintApi = process.env.CROSSMINT_API_KEY;

if (!crossmintWallet || !crossmintApi) {
  throw new Error(
    "Missing required environment variables: CROSSMINT_WALLET and CROSSMINT_API_KEY",
  );
}

const network = "devnet";

const usdcInfo = lookupKnownSPLToken(network, "USDC");
if (!usdcInfo) {
  throw new Error("couldn't look up USDC on devnet");
}

const wallet = await createCrossmintWallet(
  network,
  crossmintApi,
  crossmintWallet,
);

const rpc = createSolanaRpc("https://api.devnet.solana.com");
const mint = address(usdcInfo.address);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [
    createPaymentHandler(
      wallet,
      mint,
      rpc,
      // Crossmint only exposes sendTransaction; enable settlement-account
      // mode so the x402 exact handler takes the sendTransaction path.
      { features: { enableSettlementAccounts: true } },
    ),
  ],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
await logResponse(req);
