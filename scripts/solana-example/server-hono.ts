import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { hono as middleware } from "@faremeter/middleware";
import { Keypair } from "@solana/web3.js";
import fs from "fs";

const { PAYTO_KEYPAIR_PATH, ASSET_ADDRESS } = process.env;

if (!PAYTO_KEYPAIR_PATH) {
  throw new Error("ADMIN_KEYPAIR_PATH must be set in your environment");
}

if (!ASSET_ADDRESS) {
  throw new Error("ASSET_ADDRESS must point at an SPL Token address");
}

const payToKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYTO_KEYPAIR_PATH, "utf-8"))),
);

const network = "devnet";

const asset = ASSET_ADDRESS;

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
        asset: "sol",
      },
      // Our custom mint
      {
        ...paymentRequired,
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
  console.log(`Listening on http://localhost:${info.port}`);
});
