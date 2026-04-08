import "dotenv/config";
import { logger } from "../logger";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createMiddleware } from "@faremeter/middleware/hono";
import { createRemoteX402Handlers } from "@faremeter/middleware";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
} from "@solana/kit";
import {
  lookupKnownSPLToken,
  lookupX402Network,
  x402Exact,
} from "@faremeter/info/solana";
import {
  createMPPSolanaChargeHandler,
  createMPPSolanaNativeChargeHandler,
  createInMemoryReplayStore,
} from "@faremeter/payment-solana/charge";
import crypto from "crypto";
import fs from "fs";

const { PAYTO_KEYPAIR_PATH, ADMIN_KEYPAIR_PATH } = process.env;

if (!PAYTO_KEYPAIR_PATH) {
  throw new Error("PAYTO_KEYPAIR_PATH must be set in your environment");
}

if (!ADMIN_KEYPAIR_PATH) {
  throw new Error("ADMIN_KEYPAIR_PATH must be set in your environment");
}

const payToSigner = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYTO_KEYPAIR_PATH, "utf-8"))),
);

const adminSigner = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))),
);

const network = "devnet";
const solanaNetwork = lookupX402Network(network);
const payTo = payToSigner.address;
const rpc = createSolanaRpc("https://api.devnet.solana.com");

const usdcInfo = lookupKnownSPLToken(network, "USDC");
if (!usdcInfo) {
  throw new Error("couldn't look up USDC on devnet");
}

const usdcMint = address(usdcInfo.address);
const secretKey = crypto.randomBytes(32);

const x402Accepts = [
  x402Exact({
    network,
    asset: "USDC",
    amount: "10000",
    payTo,
  }),
];

const x402Handlers = createRemoteX402Handlers({
  facilitatorURL: "http://localhost:4000",
  accepts: x402Accepts,
});

const mppUSDCHandler = await createMPPSolanaChargeHandler({
  network,
  rpc,
  feePayerSigner: adminSigner,
  mint: usdcMint,
  replayStore: createInMemoryReplayStore(),
  realm: "mpp-example",
  secretKey,
});

const mppSOLHandler = await createMPPSolanaNativeChargeHandler({
  network,
  rpc,
  feePayerSigner: adminSigner,
  replayStore: createInMemoryReplayStore(),
  realm: "mpp-example",
  secretKey,
});

const app = new Hono();

app.get("/health", (c) => c.text("ok"));

app.get(
  "/protected",
  await createMiddleware({
    x402Handlers,
    mppMethodHandlers: [mppUSDCHandler, mppSOLHandler],
    pricing: [
      {
        amount: "10000",
        asset: usdcInfo.address,
        recipient: payTo,
        network: solanaNetwork.caip2,
      },
      {
        amount: "1000000",
        asset: "sol",
        recipient: payTo,
        network: solanaNetwork.caip2,
      },
    ],
  }),
  (c) => {
    return c.json({ msg: "success" });
  },
);

serve(app, (info) => {
  logger.info(`MPP+x402 server listening on http://localhost:${info.port}`);
});
