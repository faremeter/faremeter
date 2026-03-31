import type { RouteConfig } from "../types.js";
import { readLua, luaEscape } from "./common.js";

type AccessOpts = {
  routes: RouteConfig[];
  sidecarURL: string;
};

// RFC 9110 defines GET HEAD POST PUT DELETE CONNECT OPTIONS TRACE; PATCH is
// RFC 5789. We accept the subset that makes sense as metered operations and
// reject anything else loudly at generation time.
const ALLOWED_HTTP_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

function validateMethod(method: string): void {
  if (!ALLOWED_HTTP_METHODS.has(method)) {
    throw new Error(
      `unsupported HTTP method for gateway route: ${JSON.stringify(method)}`,
    );
  }
}

export function generateAccessBlock(opts: AccessOpts): string {
  const { routes, sidecarURL } = opts;

  // Emit the method key in bracket form with luaEscape even though
  // validateMethod has already reduced the input to a static allow-list.
  // Defence-in-depth: the generator API accepts RouteConfig from callers
  // who may not use our parser, so sanitize at the emit site too.
  const opEntries = routes.map((r) => {
    validateMethod(r.method);
    const key = luaEscape(r.method);
    const value = luaEscape(`${r.method} ${r.path}`);
    return `  ["${key}"] = "${value}"`;
  });

  const preamble = `local op_keys = {
${opEntries.join(",\n")}
}
local sidecar_url = "${luaEscape(sidecarURL)}"`;

  return preamble + "\n\n" + readLua("access.lua");
}
