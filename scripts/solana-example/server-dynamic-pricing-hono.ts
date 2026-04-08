import "dotenv/config";
import { logger } from "../logger";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { StatusCode } from "hono/utils/http-status";
import {
  x402Exact,
  lookupX402Network,
  lookupKnownSPLToken,
} from "@faremeter/info/solana";
import {
  handleMiddlewareRequest,
  resolveSupportedVersions,
} from "@faremeter/middleware/common";
import { createRemoteX402Handlers } from "@faremeter/middleware";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import fs from "fs";

const { PAYTO_KEYPAIR_PATH } = process.env;

if (!PAYTO_KEYPAIR_PATH) {
  throw new Error("PAYTO_KEYPAIR_PATH must be set in your environment");
}

const payToSigner = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYTO_KEYPAIR_PATH, "utf-8"))),
);

const network = "devnet";
const solanaNetwork = lookupX402Network(network);
const payTo = payToSigner.address;

const usdcInfo = lookupKnownSPLToken(network, "USDC");
if (!usdcInfo) {
  throw new Error("couldn't look up USDC on devnet");
}

const app = new Hono();

app.get("/health", (c) => c.text("ok"));

app.get("/protected", async (c) => {
  const amount = c.req.query("amount");

  if (amount === undefined) {
    throw new HTTPException(400, {
      message: "you need to provide an 'amount' querystring parameter",
    });
  }

  const x402Handlers = createRemoteX402Handlers({
    facilitatorURL: "http://localhost:4000",
    accepts: x402Exact({
      network,
      asset: "USDC",
      amount,
      payTo,
    }),
  });

  const sendJSONResponse = (
    status: StatusCode,
    body?: object,
    headers?: Record<string, string>,
  ) => {
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        c.header(key, value);
      }
    }
    c.status(status);
    return c.json(body);
  };

  return await handleMiddlewareRequest({
    x402Handlers,
    pricing: [
      {
        amount,
        asset: usdcInfo.address,
        recipient: payTo,
        network: solanaNetwork.caip2,
      },
    ],
    supportedVersions: resolveSupportedVersions(),
    resource: c.req.url,
    getHeader: (key) => c.req.header(key),
    setResponseHeader: (key, value) => c.header(key, value),
    sendJSONResponse,
    body: async (context) => {
      const result = await context.settle();
      if (!result.success) {
        return result.errorResponse;
      }

      return sendJSONResponse(200, { msg: "success", chargedAmount: amount });
    },
  });
});

serve(app, (info) => {
  logger.info(
    `Dynamic pricing server listening on http://localhost:${info.port}`,
  );
});
