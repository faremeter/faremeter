import type { TransportType } from "@faremeter/middleware-openapi";

export type { TransportType } from "@faremeter/middleware-openapi";

export type FieldRef = {
  path: string;
  source: "body" | "headers" | "status";
};

export type PricingMode = "two-phase" | "one-phase";

export type RouteConfig = {
  path: string;
  method: string;
  pricingRules: Record<string, string>;
  transportType: TransportType;
  pricingMode: PricingMode;
  captureFields: FieldRef[];
};

export type GeneratorInput = {
  routes: RouteConfig[];
  sidecarURL: string;
  upstreamURL: string;
  specRoot?: string | undefined;
  sitePrefix?: string | undefined;
  extraDirectives?: string[] | undefined;
};

export type GeneratorOutput = {
  locationsConf: string;
  luaFiles: Map<string, string>;
  warnings: string[];
};
