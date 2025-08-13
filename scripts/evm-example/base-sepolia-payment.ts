import "dotenv/config";
import { createLocalWallet } from "@faremeter/wallet-evm";
import { createPaymentHandler } from "@faremeter/payment-evm";
import { wrap as wrapFetch } from "@faremeter/fetch";

const { EVM_PRIVATE_KEY } = process.env;

if (!EVM_PRIVATE_KEY) {
  throw new Error("EVM_PRIVATE_KEY must be set in your environment");
}

// Parse command line arguments
const args = process.argv.slice(2);
const port = args[0] ?? "4021";
const endpoint = args[1] ?? "weather";
const url = `http://localhost:${port}/${endpoint}`;

console.log("Creating wallet for Base Sepolia USDC payments...");
const wallet = await createLocalWallet("base-sepolia", EVM_PRIVATE_KEY);
console.log(`Wallet address: ${wallet.address}`);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createPaymentHandler(wallet)],
});

console.log(`Making payment request to ${url}...`);
try {
  const req = await fetchWithPayer(url);
  console.log("Status:", req.status);
  console.log("Headers:", Object.fromEntries(req.headers));
  const response = await req.json();
  console.log("Response:", response);
} catch (error) {
  console.error("Error:", error);
}
