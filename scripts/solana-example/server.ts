import { default as express } from "express";
import type { Request, Response } from "express";
import { createFacilitatorHandler } from "@faremeter/x402-solana/facilitator";
import { express as middleware } from "@faremeter/middleware";
import { clusterApiUrl, Connection, Keypair } from "@solana/web3.js";
import fs from "fs";

const adminKeypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/admin.json", "utf-8")),
  ),
);

const network = "devnet";
const connection = new Connection(clusterApiUrl(network), "confirmed");

const run = async () => {
  const app = express();

  app.get(
    "/protected",
    middleware.createDirectFacilitatorMiddleware({
      handlers: [
        createFacilitatorHandler(
          network,
          connection,
          {
            payTo: Keypair.generate().publicKey,
            amount: 1000000,
          },
          adminKeypair,
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
