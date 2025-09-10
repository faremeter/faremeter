import "dotenv/config";
import { logger } from "../logger";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { hono as middleware } from "@faremeter/middleware";
import { Keypair } from "@solana/web3.js";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import fs from "fs";

const { PAYTO_KEYPAIR_PATH } = process.env;

if (!PAYTO_KEYPAIR_PATH) {
  throw new Error("ADMIN_KEYPAIR_PATH must be set in your environment");
}

const payToKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYTO_KEYPAIR_PATH, "utf-8"))),
);

const network = "devnet";
const splTokenName = "USDC";

const usdcInfo = lookupKnownSPLToken(network, splTokenName);
if (!usdcInfo) {
  throw new Error(`couldn't look up SPLToken ${splTokenName} on ${network}!`);
}

const asset = usdcInfo.address;

const port = 3000;

const paymentRequired = {
  scheme: "@faremeter/x-solana-settlement",
  network,
  payTo: payToKeypair.publicKey.toBase58(),
  maxAmountRequired: "1000000",
  resource: `http://localhost:${port}/protected`,
  description: "a protected resource",
  mimeType: "application/json",
  maxTimeoutSeconds: 5,
};

const app = new Hono();

app.get(
  "/protected",
  await middleware.createMiddleware({
    facilitatorURL: "http://localhost:4000",
    accepts: [
      // Native Solana
      {
        ...paymentRequired,
        scheme: "@faremeter/x-solana-settlement",
        asset: "sol",
      },
      // Our custom mint
      {
        ...paymentRequired,
        scheme: "@faremeter/x-solana-settlement",
        asset,
      },
      // Exact payment with our custom mint
      {
        ...paymentRequired,
        network: `solana-${network}`,
        scheme: "exact",
        asset,
      },
    ],
  }),
  (c) => {
    return c.json({
      msg: "success",
    });
  },
);

serve(app, (info) => {
  logger.info(`Listening on http://localhost:${info.port}`);
});
