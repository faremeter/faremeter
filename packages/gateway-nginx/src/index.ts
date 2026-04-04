import type { GeneratorInput, GeneratorOutput } from "./types.js";
import { generateNginxConf } from "./nginx/index.js";
import { generateLuaFiles } from "./lua/index.js";
import { detectOverlaps } from "./path.js";

export function generateConfig(input: GeneratorInput): GeneratorOutput {
  const { routes, sidecarURL, upstreamURL } = input;
  const warnings: string[] = [];

  const overlapWarnings = detectOverlaps(routes.map((r) => r.path));
  warnings.push(...overlapWarnings);

  const luaFiles = generateLuaFiles();

  const { nginxConf, warnings: nginxWarnings } = generateNginxConf({
    routes,
    sidecarURL,
    upstreamURL,
    luaPackagePath: "/etc/nginx/lua",
  });
  warnings.push(...nginxWarnings);

  return {
    nginxConf,
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

export { extractSpec, loadSpec } from "./parser.js";
export { analyzeRule } from "./analyzer.js";
export { convertPath, detectOverlaps } from "./path.js";
export { generateNginxConf } from "./nginx/index.js";
export { generateLuaFiles } from "./lua/index.js";
