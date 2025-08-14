import {
  createLedgerSolanaWallet,
  selectLedgerAccount,
} from "@faremeter/wallet-ledger";
import { createPaymentHandler } from "@faremeter/x-solana-settlement";
import { wrap as wrapFetch } from "@faremeter/fetch";

// Parse command line arguments
const args = process.argv.slice(2);
const port = args[0] ?? "3000";
const endpoint = args[1] ?? "protected";
const url = `http://localhost:${port}/${endpoint}`;

console.log("Connecting to Ledger for Solana payments...");
console.log("\nRequired Ledger Settings:");
console.log("1. Open the Solana app on your Ledger");
console.log("2. When prompted, approve the transaction on your Ledger");

try {
  const selected = await selectLedgerAccount("solana", 5);

  if (!selected) {
    process.exit(0);
  }

  console.log(`\nUsing account: ${selected.address}`);

  const ledgerWallet = await createLedgerSolanaWallet("devnet", selected.path);

  const fetchWithPayer = wrapFetch(fetch, {
    handlers: [createPaymentHandler(ledgerWallet)],
  });

  console.log(`\nMaking payment request to ${url}...`);
  console.log("When prompted, confirm the transaction on your Ledger...");

  let req;
  try {
    req = await fetchWithPayer(url);
  } catch (fetchError) {
    await ledgerWallet.disconnect();
    const errorMessage = (fetchError as Error).message;
    console.error(`\nError: ${errorMessage}`);
    if (
      errorMessage.includes("fetch failed") ??
      errorMessage.includes("ECONNREFUSED")
    ) {
      console.error(
        `Are you sure the Faremeter server is running on port ${port}?`,
      );
    }
    process.exit(1);
  }

  console.log("Status:", req.status);
  console.log("Headers:", Object.fromEntries(req.headers));
  const response = await req.json();
  console.log("Response:", response);

  await ledgerWallet.disconnect();
  console.log("\nSuccess! Ledger payment completed.");
} catch (error) {
  console.error("Error:", (error as Error).message);
}
