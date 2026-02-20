import "dotenv/config";

import { logResponse } from "../logger";
import { wrap as wrapFetch } from "@faremeter/fetch";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import { createPaymentHandler } from "@faremeter/payment-solana/exact";
import { createSwigWallet } from "@faremeter/wallet-solana-swig";
import { Connection, Keypair, PublicKey, type Cluster } from "@solana/web3.js";
import { fetchSwig } from "@swig-wallet/classic";
import fs from "fs";

const {
  SWIG_AUTHORITY_KEYPAIR_PATH,
  SWIG_ADDRESS,
  SWIG_ROLE_ID,
  SWIG_WITH_SUBACCOUNT,
  SOLANA_NETWORK,
  SOLANA_RPC_URL,
} = process.env;

if (!SWIG_AUTHORITY_KEYPAIR_PATH) {
  throw new Error(
    "SWIG_AUTHORITY_KEYPAIR_PATH must be set in your environment",
  );
}

if (!SWIG_ADDRESS) {
  throw new Error("SWIG_ADDRESS must be set in your environment");
}

if (!SWIG_ROLE_ID) {
  throw new Error("SWIG_ROLE_ID must be set in your environment");
}

if (!SOLANA_RPC_URL) {
  throw new Error("SOLANA_RPC_URL must be set in your environment");
}

const network = (SOLANA_NETWORK ?? "devnet") as Cluster;

const authority = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync(SWIG_AUTHORITY_KEYPAIR_PATH, "utf-8")),
  ),
);

const connection = new Connection(SOLANA_RPC_URL);
const swigAddress = new PublicKey(SWIG_ADDRESS);
const swig = await fetchSwig(connection, swigAddress);

const roleId = Number.parseInt(SWIG_ROLE_ID, 10);
if (Number.isNaN(roleId)) {
  throw new Error("SWIG_ROLE_ID must be a number");
}

const withSubAccount = SWIG_WITH_SUBACCOUNT === "true";

const wallet = await createSwigWallet({
  network,
  connection,
  swig,
  roleId,
  authority,
  withSubAccount,
});

const usdcInfo = lookupKnownSPLToken(network, "USDC");
if (!usdcInfo) {
  throw new Error(`couldn't find USDC metadata for ${network}`);
}

const mint = new PublicKey(usdcInfo.address);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [
    createPaymentHandler(wallet, mint, connection, {
      token: { allowOwnerOffCurve: true },
      features: { enableSettlementAccounts: true },
    }),
  ],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");

await logResponse(req);
