import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FieldRef } from "../types.js";

const luaDir = dirname(fileURLToPath(import.meta.url));

export function readLua(name: string): string {
  return readFileSync(join(luaDir, name), "utf-8");
}

export function luaEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

/**
 * Strip the `[$.]response.body` prefix from a capture field and return
 * the remainder with its leading bracket preserved. Throws on any path
 * that doesn't target `response.body.*` or `response.body[...]`.
 */
export function bodyFieldPath(ref: FieldRef): string {
  const match = /^(?:\$\.)?response\.body((?:\.|\[).*)$/.exec(ref.path);
  if (!match) {
    throw new Error(
      `bodyFieldPath: ${JSON.stringify(ref.path)} is not a response.body path`,
    );
  }
  const tail = match[1] ?? "";
  // Drop the leading dot (if any); preserve a leading `[` for bracket form.
  return tail.startsWith(".") ? tail.slice(1) : tail;
}

export function searchKeys(fields: FieldRef[]): string[] {
  const keys = new Set<string>();
  for (const f of fields) {
    if (f.source !== "body") continue;
    const path = bodyFieldPath(f);
    const quotedBracket = /^\['([^']+)'\]/.exec(path);
    if (quotedBracket?.[1]) {
      keys.add(quotedBracket[1]);
      continue;
    }
    if (/^\[\d+\]/.test(path)) {
      // Top-level array element has no named key to gate on.
      continue;
    }
    const topLevel = path.split(/[.[]/)[0];
    if (!topLevel) {
      throw new Error(
        `searchKeys: cannot derive top-level key from ${JSON.stringify(f.path)}`,
      );
    }
    keys.add(topLevel);
  }
  return [...keys];
}
