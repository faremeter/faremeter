import "dotenv/config";
import { createLocalWallet } from "@faremeter/wallet-evm";
import { createPaymentHandler } from "@faremeter/payment-evm";
import { wrap as wrapFetch } from "@faremeter/fetch";

const { ETH_PRIVATE_KEY } = process.env;

if (!ETH_PRIVATE_KEY) {
  throw new Error("ETH_PRIVATE_KEY must be set in your environment");
}

console.log("Creating wallet for Base Sepolia USDC payments...");
const wallet = await createLocalWallet("base-sepolia", ETH_PRIVATE_KEY);
console.log(`Wallet address: ${wallet.address}`);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet)],
});

console.log("Making payment request to x402 server...");
try {
  const req = await fetchWithPayer("http://localhost:4021/weather");
  console.log("Status:", req.status);
  console.log("Headers:", Object.fromEntries(req.headers));
  const response = await req.json();
  console.log("Response:", response);
} catch (error) {
  console.error("Error:", error);
}
