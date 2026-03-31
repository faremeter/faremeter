const PARAM_PATTERN = /\{[^}]+\}/;
const PARAM_PATTERN_GLOBAL = /\{[^}]+\}/g;
const PARAM_REPLACEMENT = "([^/]+)";

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
