import "dotenv/config";
import { default as express } from "express";
import { createFacilitatorHandler } from "@faremeter/x-solana-settlement/facilitator";
import {
  createFacilitatorHandler as createFacilitatorHandlerExact,
  lookupX402Network,
} from "@faremeter/payment-solana-exact";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createFacilitatorRouter } from "./routes";
import fs from "fs";
import { createSolanaRpc } from "@solana/kit";

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
const apiUrl = clusterApiUrl(network);
const listenPort = 4000;

const connection = new Connection(apiUrl, "confirmed");
const rpc = createSolanaRpc(apiUrl);

const mint = new PublicKey(ASSET_ADDRESS);

const app = express();
app.use(
  "/",
  createFacilitatorRouter({
    handlers: [
      // SOL
      createFacilitatorHandler(network, connection, adminKeypair),
      // Our Private Mint Above
      createFacilitatorHandler(network, connection, adminKeypair, mint),
      // Out Private Mint with exact scheme
      createFacilitatorHandlerExact(
        lookupX402Network(network),
        rpc,
        adminKeypair,
        mint,
      ),
    ],
  }),
);

app.listen(listenPort, () => {
  console.log(`server listening on ${listenPort}`);
});
