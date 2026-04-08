import "dotenv/config";
import { logger } from "../logger";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createMiddleware } from "@faremeter/middleware/hono";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import {
  clusterToCAIP2,
  lookupKnownSPLToken,
  x402Exact,
} from "@faremeter/info/solana";
import fs from "fs";

const { PAYTO_KEYPAIR_PATH } = process.env;

if (!PAYTO_KEYPAIR_PATH) {
  throw new Error("PAYTO_KEYPAIR_PATH must be set in your environment");
}

const payToSigner = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYTO_KEYPAIR_PATH, "utf-8"))),
);

const network = "devnet";
const splTokenName = "USDC";

const usdcInfo = lookupKnownSPLToken(network, splTokenName);
if (!usdcInfo) {
  throw new Error(`couldn't look up SPLToken ${splTokenName} on ${network}!`);
}

const payTo = payToSigner.address;

const app = new Hono();

app.get("/health", (c) => c.text("ok"));

app.get(
  "/protected",
  await createMiddleware({
    facilitatorURL: "http://localhost:4000",
    accepts: [
      // USDC Exact Payment
      x402Exact({
        network,
        asset: "USDC",
        amount: "10000", // 0.01 USDC
        payTo,
      }),
      // PYUSD Exact Payment (Token-2022)
      x402Exact({
        network,
        asset: "PYUSD",
        amount: "10000",
        payTo,
      }),
      // Flex Payment (USDC)
      {
        scheme: "flex",
        network: clusterToCAIP2(network).caip2,
        maxAmountRequired: usdcInfo.toUnit("10000"),
        payTo,
        asset: usdcInfo.address,
        maxTimeoutSeconds: 60,
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
