import type { RouteConfig } from "../types.js";
import { readLua } from "./common.js";
import { generateAccessBlock } from "./access.js";
import { generateHeaderFilterBlock } from "./header-filter.js";
import { generateBodyFilterBlock } from "./body-filter.js";
import { generateLogBlock } from "./log.js";
import { generateWebSocketBlock } from "./websocket.js";

export type LuaBlocks = {
  access: string;
  headerFilter: string;
  bodyFilter: string;
  log: string;
};

export type WebSocketBlocks = {
  access: string;
  content: string;
};

export function generateLuaFiles(): Map<string, string> {
  const files = new Map<string, string>();
  files.set("faremeter.lua", readLua("shared.lua"));
  return files;
}

export function generateHTTPLuaBlocks(
  routes: RouteConfig[],
  sidecarURL: string,
): LuaBlocks {
  const firstRoute = routes[0];
  if (!firstRoute) {
    throw new Error("generateHTTPLuaBlocks requires at least one route");
  }

  return {
    access: generateAccessBlock({ routes, sidecarURL }),
    headerFilter: generateHeaderFilterBlock({
      captureFields: routes.flatMap((r) => r.captureFields),
    }),
    bodyFilter: generateBodyFilterBlock({
      captureFields: routes.flatMap((r) => r.captureFields),
    }),
    log: generateLogBlock(firstRoute, sidecarURL),
  };
}

export function generateWebSocketLuaBlocks(
  route: RouteConfig,
  sidecarURL: string,
  upstreamURL: string,
): WebSocketBlocks {
  return {
    access: generateAccessBlock({ routes: [route], sidecarURL }),
    content: generateWebSocketBlock(route, sidecarURL, upstreamURL),
  };
}

export {
  generateAccessBlock,
  generateHeaderFilterBlock,
  generateBodyFilterBlock,
  generateLogBlock,
  generateWebSocketBlock,
};
