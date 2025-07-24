import { default as express } from "express";
import type { Request, Response } from "express";
import { createFacilitatorHandler } from "@faremeter/x402-solana/facilitator";
import { express as middleware } from "@faremeter/middleware";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

const adminKeypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/admin.json", "utf-8")),
  ),
);

const network = "devnet";
const connection = new Connection(clusterApiUrl(network), "confirmed");

const payTo = Keypair.generate();
const mint = new PublicKey("Hxtm6jXVcA9deMFxJRvMkHewhYJHxCpqsLvH9d1bvxBP");

// Make sure the token receiver exists.
await getOrCreateAssociatedTokenAccount(
  connection,
  adminKeypair,
  mint,
  payTo.publicKey,
);

const protectedRequirements = {
  payTo: payTo.publicKey,
  amount: 1000000,
};

const run = async () => {
  const app = express();

  app.get(
    "/protected",
    middleware.createDirectFacilitatorMiddleware({
      handlers: [
        createFacilitatorHandler(
          network,
          connection,
          protectedRequirements,
          adminKeypair,
        ),
        createFacilitatorHandler(
          network,
          connection,
          protectedRequirements,
          adminKeypair,
          mint,
        ),
      ],
    }),
    (req: Request, res: Response) => {
      res.json({
        msg: "success",
      });
    },
  );

  app.listen(3000);
};

run();
