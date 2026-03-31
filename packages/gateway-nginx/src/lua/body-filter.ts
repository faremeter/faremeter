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
  const keys = searchKeys(captureFields).map((k) => `  "${luaEscape(k)}"`);

  const preamble = `local capture_fields = {
${fieldPaths.join(",\n")}
}
local search_keys = {
${keys.join(",\n")}
}`;

  return preamble + "\n\n" + readLua("body-filter.lua");
}
