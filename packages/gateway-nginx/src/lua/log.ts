import { readLua, luaEscape } from "./common.js";

export function generateLogBlock(sidecarURL: string): string {
  const preamble = `local sidecar_url = "${luaEscape(sidecarURL)}"`;

  return preamble + "\n\n" + readLua("log.lua");
}
