import type { RouteConfig } from "../types.js";
import { generateServerBlock, generateServerBlockClose } from "./server.js";
import { generateLocationBlocks } from "./location.js";

type NginxGeneratorOpts = {
  routes: RouteConfig[];
  sidecarURL: string;
  upstreamURL: string;
  luaPackagePath: string;
};

type NginxGeneratorResult = {
  nginxConf: string;
  warnings: string[];
};

export function generateNginxConf(
  opts: NginxGeneratorOpts,
): NginxGeneratorResult {
  const { routes, sidecarURL, upstreamURL, luaPackagePath } = opts;

  const serverBlock = generateServerBlock({
    upstreamURL,
    sidecarURL,
    luaPackagePath,
  });
  const { block: locationBlocks, warnings } = generateLocationBlocks(routes, {
    sidecarURL,
    upstreamURL,
  });
  const serverClose = generateServerBlockClose();

  const indentedLocations = locationBlocks
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : "    " + line))
    .join("\n");

  const nginxConf = [
    "worker_processes auto;",
    "",
    "events {",
    "  worker_connections 1024;",
    "}",
    "",
    serverBlock,
    "",
    indentedLocations,
    "",
    serverClose,
    "",
  ].join("\n");

  return { nginxConf, warnings };
}

export { generateServerBlock, generateServerBlockClose } from "./server.js";
export { generateLocationBlocks } from "./location.js";
