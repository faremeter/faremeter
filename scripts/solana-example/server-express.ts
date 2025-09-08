import "dotenv/config";
import "../logger";
import { default as express } from "express";
import type { Request, Response } from "express";
import { express as middleware } from "@faremeter/middleware";
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
  network,
  payTo: payToKeypair.publicKey.toBase58(),
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
    (req: Request, res: Response) => {
      res.json({
        msg: "success",
      });
    },
  );

  app.listen(port);
};

await run();
