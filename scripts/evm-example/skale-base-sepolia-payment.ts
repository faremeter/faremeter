import "dotenv/config";
import { logger, logResponse } from "../logger";
import { createLocalWallet } from "@faremeter/wallet-evm";
import { createPaymentHandler } from "@faremeter/payment-evm/exact";
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

logger.info("Creating wallet for Base Sepolia USDC payments...");
const wallet = await createLocalWallet(
  {
    id: 2140350733,
    name: "SKALE Base Sepolia Testnet",
    rpcUrls: {
      default: {
        http: [
          "https://base-sepolia-testnet.skalenodes.com/v1/basic-defiant-hadar",
        ],
      },
    },
    blockExplorers: {
      default: {
        name: "Blockscout",
        url: "https://base-sepolia-testnet-explorer.skalenodes.com:10011",
      },
    },
    nativeCurrency: {
      name: "Credits",
      decimals: 18,
      symbol: "CRED",
    },
  },
  EVM_PRIVATE_KEY,
);
logger.info(`Wallet address: ${wallet.address}`);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [
    createPaymentHandler(wallet, {
      asset: "AxiosUSD",
    }),
  ],
});

logger.info(`Making payment request to ${url}...`);
const req = await fetchWithPayer(url);
await logResponse(req);
