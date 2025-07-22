import { default as express } from "express";
import type { Request, Response } from "express";
import { paymentMiddleware } from "@faremeter/x402-solana/facilitator";
import { clusterApiUrl, Connection, Keypair } from "@solana/web3.js";
import fs from "fs";

const adminKeypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/admin.json", "utf-8")),
  ),
);

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

const run = async () => {
  const app = express();

  app.get(
    "/protected",
    paymentMiddleware(
      connection,
      {
        payTo: Keypair.generate().publicKey,
        amount: 1000000,
      },
      adminKeypair,
    ),
    (req: Request, res: Response) => {
      res.json({
        msg: "success",
      });
    },
  );

  app.listen(3000);
};

run();
