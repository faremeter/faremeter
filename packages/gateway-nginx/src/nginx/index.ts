import type { RouteConfig } from "../types.js";
import { generateLocationBlocks } from "./location.js";

type NginxGeneratorOpts = {
  routes: RouteConfig[];
  sidecarURL: string;
  upstreamURL: string;
  specRoot?: string | undefined;
  sitePrefix?: string | undefined;
  extraDirectives?: string[] | undefined;
};

type NginxGeneratorResult = {
  locationsConf: string;
  warnings: string[];
};

export function generateNginxConf(
  opts: NginxGeneratorOpts,
): NginxGeneratorResult {
  const {
    routes,
    sidecarURL,
    upstreamURL,
    specRoot,
    sitePrefix,
    extraDirectives,
  } = opts;

  const effectiveSidecarURL = sitePrefix
    ? `${sidecarURL}/sites/${sitePrefix}`
    : sidecarURL;

  const { block: locationBlocks, warnings } = generateLocationBlocks(routes, {
    sidecarURL: effectiveSidecarURL,
    upstreamURL,
    specRoot,
    extraDirectives,
  });

  return { locationsConf: locationBlocks, warnings };
}

export { generateLocationBlocks } from "./location.js";
