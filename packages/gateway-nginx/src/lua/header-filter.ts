import type { FieldRef } from "../types.js";
import { readLua, luaEscape } from "./common.js";

type HeaderFilterOpts = {
  captureFields: FieldRef[];
};

export function generateHeaderFilterBlock(opts: HeaderFilterOpts): string {
  const { captureFields } = opts;

  const headerFields = captureFields.filter((f) => f.source === "headers");
  const names = headerFields.map((f) => {
    const dotMatch = /^\$\.response\.headers\.(.+)$/.exec(f.path);
    if (dotMatch?.[1]) return `  "${luaEscape(dotMatch[1])}"`;
    const bracketMatch = /^\$\.response\.headers\['([^']+)'\]/.exec(f.path);
    if (bracketMatch?.[1]) return `  "${luaEscape(bracketMatch[1])}"`;
    return `  "${luaEscape(f.path)}"`;
  });

  const preamble = `local capture_header_names = {
${names.join(",\n")}
}`;

  return preamble + "\n\n" + readLua("header-filter.lua");
}
