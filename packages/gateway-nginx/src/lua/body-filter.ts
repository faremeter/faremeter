import type { FieldRef } from "../types.js";
import { readLua, luaEscape, bodyFieldPath, searchKeys } from "./common.js";

type BodyFilterOpts = {
  captureFields: FieldRef[];
};

export function generateBodyFilterBlock(opts: BodyFilterOpts): string {
  const { captureFields } = opts;
  const bodyFields = captureFields.filter((f) => f.source === "body");

  if (bodyFields.length === 0) {
    return `if not ngx.ctx.fm_paid then
  return
end`;
  }

  const fieldPaths = bodyFields.map(
    (f) => `  "${luaEscape(bodyFieldPath(f))}"`,
  );
  // Pre-encode each key as JSON (via JSON.stringify) so the Lua probe
  // can use the exact byte sequence a compliant JSON encoder would
  // emit, including escape sequences for keys containing `"`, `\`, or
  // control characters. The Lua side treats these as literal search
  // strings (ngx.find with plain=true), so there is no concatenation
  // with bare quotes at runtime.
  const keys = searchKeys(captureFields).map(
    (k) => `  "${luaEscape(JSON.stringify(k))}"`,
  );

  const preamble = `local capture_fields = {
${fieldPaths.join(",\n")}
}
local search_keys = {
${keys.join(",\n")}
}`;

  return preamble + "\n\n" + readLua("body-filter.lua");
}
