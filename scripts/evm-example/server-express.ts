import "dotenv/config";
import { logger } from "../logger";
import { default as express } from "express";
import type { Request, Response } from "express";
import { express as middleware } from "@faremeter/middleware";
import { isAddress, Address } from "@faremeter/types/evm";
import { x402Exact } from "@faremeter/info/evm";

const { EVM_RECEIVING_ADDRESS, PORT } = process.env;

const payTo = EVM_RECEIVING_ADDRESS as Address;

if (!isAddress(payTo)) {
  throw new Error(
    "EVM_RECEIVING_ADDRESS must be set in your environment, and be a valid EVM address",
  );
}

const network = "base-sepolia";
const port = PORT ? parseInt(PORT) : 4021;

const run = async () => {
  const app = express();

  app.get(
    "/weather",
    await middleware.createMiddleware({
      facilitatorURL: "http://localhost:4000",
      accepts: [
        x402Exact({
          network,
          asset: "USDC",
          payTo,
          amount: "10000", // 0.01 USDC
        }),
      ],
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
  });
};

await run();
