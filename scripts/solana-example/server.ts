import { default as express } from "express";
import type { Request, Response } from "express";
import { paymentMiddleware } from "@faremeter/x402-solana/middleware";
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
        receiver: Keypair.generate().publicKey,
        amount: 1000000,
        admin: adminKeypair.publicKey,
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
