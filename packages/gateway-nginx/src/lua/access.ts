import type { RouteConfig } from "../types.js";
import { readLua, luaEscape } from "./common.js";

type AccessOpts = {
  routes: RouteConfig[];
  sidecarURL: string;
};

export function generateAccessBlock(opts: AccessOpts): string {
  const { routes, sidecarURL } = opts;

  const opEntries = routes.map(
    (r) => `  ${r.method} = "${luaEscape(`${r.method} ${r.path}`)}"`,
  );

  const preamble = `local op_keys = {
${opEntries.join(",\n")}
}
local sidecar_url = "${luaEscape(sidecarURL)}"`;

  return preamble + "\n\n" + readLua("access.lua");
}
