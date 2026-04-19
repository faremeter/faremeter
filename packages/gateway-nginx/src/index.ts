import type { GeneratorInput, GeneratorOutput } from "./types.js";
import { generateNginxConf } from "./nginx/index.js";
import { generateLuaFiles } from "./lua/index.js";
import { detectOverlaps } from "./path.js";

/**
 * Generate nginx location blocks and a bundled Lua module for a set
 * of parsed routes. Produces:
 *
 *   - `locationsConf` — the location block text. The operator
 *     includes this inside their own `server { }` block via
 *     `include locations.conf;`.
 *
 *   - `luaFiles` — standalone Lua modules that the generated
 *     config will `require()` at runtime. The operator places
 *     these in their `lua_package_path`. Currently produces a
 *     single `faremeter.lua` bundle.
 *
 *   - `warnings` — non-fatal concerns detected at generation time.
 *
 * Pure function: does no I/O, no network calls, no filesystem
 * access. Safe to call in tests.
 */
export function generateConfig(input: GeneratorInput): GeneratorOutput {
  const {
    routes,
    sidecarURL,
    upstreamURL,
    specRoot,
    sitePrefix,
    extraDirectives,
  } = input;
  const warnings: string[] = [];

  const overlapWarnings = detectOverlaps(routes.map((r) => r.path));
  warnings.push(...overlapWarnings);

  const luaFiles = generateLuaFiles();

  const { locationsConf, warnings: nginxWarnings } = generateNginxConf({
    routes,
    sidecarURL,
    upstreamURL,
    specRoot,
    sitePrefix,
    extraDirectives,
  });
  warnings.push(...nginxWarnings);

  return {
    locationsConf,
    luaFiles,
    warnings,
  };
}

export type {
  GeneratorInput,
  GeneratorOutput,
  RouteConfig,
  TransportType,
  FieldRef,
  PricingMode,
} from "./types.js";

export { extractGatewaySpec, loadGatewaySpec } from "./parser.js";
export { analyzeRule } from "./analyzer.js";
export { convertPath, detectOverlaps } from "./path.js";
export { generateNginxConf } from "./nginx/index.js";
export { generateLuaFiles } from "./lua/index.js";
