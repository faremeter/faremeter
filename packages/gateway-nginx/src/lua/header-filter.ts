import type { FieldRef } from "../types.js";
import { readLua, luaEscape } from "./common.js";

type HeaderFilterOpts = {
  captureFields: FieldRef[];
};

/**
 * Extract the HTTP header name from a `$.response.headers...` JSONPath.
 * Accepts `$.response.headers.Foo`, `$.response.headers['Foo']`, and
 * single-segment bracket forms. Throws on anything else rather than
 * silently emitting a nonsense header name.
 */
function headerNameFromPath(path: string): string {
  const bracketMatch = /^\$\.response\.headers\['([^']+)'\]$/.exec(path);
  if (bracketMatch?.[1]) return bracketMatch[1];

  const dotMatch = /^\$\.response\.headers\.([A-Za-z0-9_-]+)$/.exec(path);
  if (dotMatch?.[1]) return dotMatch[1];

  throw new Error(
    `header-filter: cannot extract header name from ${JSON.stringify(path)} ` +
      `(expected $.response.headers.Name or $.response.headers['Name'])`,
  );
}

export function generateHeaderFilterBlock(opts: HeaderFilterOpts): string {
  const { captureFields } = opts;

  const headerFields = captureFields.filter((f) => f.source === "headers");
  const names = headerFields.map(
    (f) => `  "${luaEscape(headerNameFromPath(f.path))}"`,
  );

  const preamble = `local capture_header_names = {
${names.join(",\n")}
}`;

  return preamble + "\n\n" + readLua("header-filter.lua");
}
