import type { RouteConfig } from "../types.js";
import { readLua, luaEscape, bodyFieldPath, searchKeys } from "./common.js";

export function generateWebSocketBlock(
  route: RouteConfig,
  sidecarURL: string,
  upstreamURL: string,
): string {
  const bodyFields = route.captureFields.filter((f) => f.source === "body");

  const fieldPaths = bodyFields.map(
    (f) => `  "${luaEscape(bodyFieldPath(f))}"`,
  );
  const keys = searchKeys(route.captureFields).map(
    (k) => `  "${luaEscape(k)}"`,
  );

  const preamble = `local sidecar_url = "${luaEscape(sidecarURL)}"
local upstream_url = "${luaEscape(upstreamURL)}"
local capture_fields = {
${fieldPaths.join(",\n")}
}
local search_keys = {
${keys.join(",\n")}
}`;

  return preamble + "\n\n" + readLua("websocket.lua");
}
