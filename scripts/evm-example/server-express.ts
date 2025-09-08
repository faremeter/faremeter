import "dotenv/config";
import { logger } from "../logger";
import { default as express } from "express";
import type { Request, Response } from "express";
import { express as middleware } from "@faremeter/middleware";

const { EVM_RECEIVING_ADDRESS, EVM_ASSET_ADDRESS, PORT } = process.env;

if (!EVM_RECEIVING_ADDRESS) {
  throw new Error("EVM_RECEIVING_ADDRESS must be set in your environment");
}

const network = "base-sepolia";
const asset = EVM_ASSET_ADDRESS ?? "0x036cbd53842c5426634e7929541ec2318f3dcf7e"; // USDC on Base Sepolia

const port = PORT ? parseInt(PORT) : 4021;

const paymentRequired = {
  scheme: "exact",
  network,
  asset,
  payTo: EVM_RECEIVING_ADDRESS,
  maxAmountRequired: "10000", // 0.01 USDC
  maxTimeoutSeconds: 300,
  resource: `http://localhost:${port}/weather`,
  description: "Weather data API",
  mimeType: "application/json",
};

const run = async () => {
  const app = express();

  app.get(
    "/weather",
    await middleware.createMiddleware({
      facilitatorURL: "http://localhost:4000",
      accepts: [paymentRequired],
    }),
    (_req: Request, res: Response) => {
      res.json({
        temperature: 72,
        conditions: "sunny",
        message: "Thanks for your payment!",
      });
    },
  );

  app.listen(port, () => {
    logger.info(`Resource server listening on port ${port}`);
    const amount = (
      parseInt(paymentRequired.maxAmountRequired) / 1_000_000
    ).toFixed(2);
    logger.info(
      `Charging ${amount} USDC per request to ${paymentRequired.resource}`,
    );
    logger.info(`Payments go to: ${EVM_RECEIVING_ADDRESS}`);
  });
};

await run();
