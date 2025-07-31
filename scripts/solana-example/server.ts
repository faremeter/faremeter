import "dotenv/config";
import { default as express } from "express";
import type { Request, Response } from "express";
import { express as middleware } from "@faremeter/middleware";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

const { ADMIN_KEYPAIR_PATH, ASSET_ADDRESS } = process.env;

if (!ADMIN_KEYPAIR_PATH) {
  throw new Error("ADMIN_KEYPAIR_PATH must be set in your environment");
}

if (!ASSET_ADDRESS) {
  throw new Error("ASSET_ADDRESS must point at an SPL Token address");
}

const adminKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))),
);

const network = "devnet";
const connection = new Connection(clusterApiUrl(network), "confirmed");

const payTo = Keypair.generate();
const asset = ASSET_ADDRESS;

// Make sure the token receiver exists.
await getOrCreateAssociatedTokenAccount(
  connection,
  adminKeypair,
  new PublicKey(asset),
  payTo.publicKey,
);

const port = 3000;

const paymentRequired = {
  scheme: "@faremeter/x-solana-settlement",
  network,
  payTo: payTo.publicKey.toBase58(),
  maxAmountRequired: "1000000",
  resource: `http://localhost:${port}/protected`,
  description: "a protected resource",
  mimeType: "application/json",
  maxTimeoutSeconds: 5,
};

const run = async () => {
  const app = express();

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
    (req: Request, res: Response) => {
      res.json({
        msg: "success",
      });
    },
  );

  app.listen(port);
};

run();
