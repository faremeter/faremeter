const PARAM_PATTERN = /\{[^}]+\}/;
const PARAM_PATTERN_GLOBAL = /\{[^}]+\}/g;
const PARAM_REPLACEMENT = "([^/]+)";

/**
 * Characters allowed in an OpenAPI path after stripping `{param}` templates.
 * Conservative: ASCII alphanumerics, unreserved URI characters, and `/`.
 * Rejects whitespace, `;`, `#`, `"`, control characters, and anything that
 * could break out of an nginx `location` directive context.
 *
 * Per RFC 3986 unreserved: `A-Z a-z 0-9 - . _ ~`
 * Plus URI sub-delims we tolerate in paths: `! $ & ' ( ) * + , = : @`
 * (We deliberately exclude `;` and `?` and `#` even though they are
 * technically valid URI sub-delims, because they are structural in nginx
 * config / query strings / fragments and increase risk without upside.)
 */
const PATH_CHAR_ALLOWLIST = /^[A-Za-z0-9/\-._~!$&'()*+,=:@{}]*$/;

export type LocationDirective = {
  directive: string;
  warnings: string[];
};

function hasParams(path: string) {
  return PARAM_PATTERN.test(path);
}

function escapeRegexSegment(s: string) {
  return s.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate an OpenAPI path for safe embedding into an nginx `location`
 * directive. Throws loudly rather than silently emitting dangerous content.
 */
function validatePath(path: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("OpenAPI path must be a non-empty string");
  }
  if (!path.startsWith("/")) {
    throw new Error(
      `OpenAPI path must start with '/', got ${JSON.stringify(path)}`,
    );
  }
  if (!PATH_CHAR_ALLOWLIST.test(path)) {
    throw new Error(
      `OpenAPI path contains characters unsafe for nginx location ` +
        `directives: ${JSON.stringify(path)}`,
    );
  }
  // Braces are allowed only as well-formed `{param}` template segments.
  // Unbalanced `{` or `}` pass the allowlist but produce a broken nginx
  // `location` directive that fails at config load time with a cryptic
  // error pointing at a generated file the user did not write. Reject at
  // generation time with a clear message instead.
  let depth = 0;
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === "{") {
      if (depth !== 0) {
        throw new Error(
          `OpenAPI path has nested or unbalanced brace at offset ${i}: ${JSON.stringify(path)}`,
        );
      }
      // An empty `{}` is not a valid parameter template — OpenAPI
      // §4.8.12.1 requires a name inside the braces. The generator
      // would emit `location = /api/{}` which nginx rejects at
      // config load.
      if (path[i + 1] === "}") {
        throw new Error(
          `OpenAPI path has empty parameter braces at offset ${i}: ${JSON.stringify(path)}`,
        );
      }
      depth++;
    } else if (ch === "}") {
      if (depth !== 1) {
        throw new Error(
          `OpenAPI path has unbalanced brace at offset ${i}: ${JSON.stringify(path)}`,
        );
      }
      depth--;
    }
  }
  if (depth !== 0) {
    throw new Error(
      `OpenAPI path has unbalanced '{' brace: ${JSON.stringify(path)}`,
    );
  }
}

function toRegexLocation(path: string) {
  const segments = path.split(PARAM_PATTERN_GLOBAL);
  const params = path.match(PARAM_PATTERN_GLOBAL) ?? [];
  let regex = "";
  for (let i = 0; i < segments.length; i++) {
    regex += escapeRegexSegment(segments[i] ?? "");
    if (i < params.length) {
      regex += PARAM_REPLACEMENT;
    }
  }
  return `~ ^${regex}$`;
}

function toExactLocation(path: string) {
  return `= ${path}`;
}

export function convertPath(path: string): LocationDirective {
  validatePath(path);
  const warnings: string[] = [];

  if (hasParams(path)) {
    return { directive: toRegexLocation(path), warnings };
  }

  return { directive: toExactLocation(path), warnings };
}

export function detectOverlaps(paths: string[]): string[] {
  const warnings: string[] = [];
  const regexPaths = paths.filter((p) => hasParams(p));

  for (let i = 0; i < regexPaths.length; i++) {
    for (let j = i + 1; j < regexPaths.length; j++) {
      const a = regexPaths[i];
      const b = regexPaths[j];
      if (!a || !b) continue;

      if (couldOverlap(a, b)) {
        warnings.push(
          `Potential regex overlap: "${a}" and "${b}" may match the same URLs. ` +
            `nginx evaluates regex locations in order of appearance.`,
        );
      }
    }
  }

  return warnings;
}

function couldOverlap(a: string, b: string): boolean {
  const aParts = a.split("/");
  const bParts = b.split("/");

  if (aParts.length !== bParts.length) {
    return false;
  }

  for (let i = 0; i < aParts.length; i++) {
    const aSeg = aParts[i];
    const bSeg = bParts[i];
    if (aSeg === undefined || bSeg === undefined) continue;
    const aIsParam = PARAM_PATTERN.test(aSeg);
    const bIsParam = PARAM_PATTERN.test(bSeg);

    if (!aIsParam && !bIsParam && aSeg !== bSeg) {
      return false;
    }
  }

  return true;
}
