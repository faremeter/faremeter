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
    .replace(/"/g, '\\"');
}

export function bodyFieldPath(ref: FieldRef): string {
  return ref.path.replace(/^(\$\.)?response\.body(?:\.|(\[))/, "$2");
}

export function searchKeys(fields: FieldRef[]): string[] {
  const keys = new Set<string>();
  for (const f of fields) {
    if (f.source !== "body") continue;
    const path = bodyFieldPath(f);
    const quotedBracket = /^\['([^']+)'\]/.exec(path);
    if (quotedBracket?.[1]) {
      keys.add(quotedBracket[1]);
    } else if (/^\[\d+\]/.test(path)) {
      continue;
    } else {
      const topLevel = path.split(/[.[]/)[0];
      if (topLevel) {
        keys.add(topLevel);
      }
    }
  }
  return [...keys];
}
