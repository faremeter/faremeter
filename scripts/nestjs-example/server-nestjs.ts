import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const app = await NestFactory.create(AppModule);
const port = process.env.PORT ? parseInt(process.env.PORT) : 4021;
await app.listen(port);
console.log(
  `Nest.js server with Faremeter middleware listening on port ${port}`,
);
