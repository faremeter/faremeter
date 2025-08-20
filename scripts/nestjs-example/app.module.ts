import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { express as middleware } from "@faremeter/middleware";

const { EVM_RECEIVING_ADDRESS, EVM_ASSET_ADDRESS } = process.env;

if (!EVM_RECEIVING_ADDRESS) {
  throw new Error("EVM_RECEIVING_ADDRESS must be set in your environment");
}

const network = "base-sepolia";
const asset = EVM_ASSET_ADDRESS ?? "0x036cbd53842c5426634e7929541ec2318f3dcf7e"; // USDC on Base Sepolia
const port = process.env.PORT ? parseInt(process.env.PORT) : 4021;

const paymentRequired = {
  scheme: "exact",
  network,
  asset,
  payTo: EVM_RECEIVING_ADDRESS,
  maxAmountRequired: "10000", // 0.01 USDC
  maxTimeoutSeconds: 300,
  resource: `http://localhost:${port}/weather`,
  description: "Access to weather data",
  mimeType: "application/json",
};

@Module({
  controllers: [AppController],
})
export class AppModule implements NestModule {
  async configure(consumer: MiddlewareConsumer) {
    const faremeterMiddleware = await middleware.createMiddleware({
      facilitatorURL: "http://localhost:4000",
      accepts: [paymentRequired],
    });

    consumer.apply(faremeterMiddleware).forRoutes("weather");
  }
}
