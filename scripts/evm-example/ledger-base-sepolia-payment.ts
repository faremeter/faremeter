import {
  createLedgerEvmWallet,
  selectLedgerAccount,
} from "@faremeter/wallet-ledger";
import { createPaymentHandler } from "@faremeter/payment-evm";
import { wrap as wrapFetch } from "@faremeter/fetch";
import type { TypedDataDefinition } from "viem";

// Parse command line arguments
const args = process.argv.slice(2);
const port = args[0] ?? "4021";
const endpoint = args[1] ?? "weather";
const url = `http://localhost:${port}/${endpoint}`;

console.log("Connecting to Ledger for Base Sepolia payments...");
console.log("\nRequired Ledger Settings:");
console.log("1. Enable 'Blind signing' in Ethereum app settings");
console.log("2. When prompted, approve the EIP-712 message on your Ledger");

try {
  const selected = await selectLedgerAccount("evm", 5);

  if (!selected) {
    process.exit(0);
  }

  console.log(`\nUsing account: ${selected.address}`);

  const ledgerWallet = await createLedgerEvmWallet(
    "base-sepolia",
    selected.path,
  );

  const walletForPayment = {
    network: ledgerWallet.network,
    address: ledgerWallet.address,
    account: {
      signTypedData: async (params: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      }) => {
        return await ledgerWallet.signTypedData(params as TypedDataDefinition);
      },
    },
  };

  const fetchWithPayer = wrapFetch(fetch, {
    handlers: [createPaymentHandler(walletForPayment)],
  });

  console.log(`\nMaking payment request to ${url}...`);
  console.log("When prompted, confirm the transaction on your Ledger...");

  const req = await fetchWithPayer(url);
  console.log("Status:", req.status);
  console.log("Headers:", Object.fromEntries(req.headers));
  const response = await req.json();
  console.log("Response:", response);

  await ledgerWallet.disconnect();
  console.log("\nSuccess! Ledger payment completed.");
} catch (error) {
  console.error("Error:", (error as Error).message);
}
