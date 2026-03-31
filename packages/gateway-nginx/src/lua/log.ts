import type { RouteConfig } from "../types.js";
import { readLua, luaEscape } from "./common.js";

export function generateLogBlock(
  _route: RouteConfig,
  sidecarURL: string,
): string {
  const preamble = `local sidecar_url = "${luaEscape(sidecarURL)}"`;

  return preamble + "\n\n" + readLua("log.lua");
}
