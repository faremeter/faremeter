export type TransportType = "json" | "sse" | "websocket";

export type FieldRef = {
  path: string;
  source: "body" | "headers" | "status";
  optional: boolean;
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

export type Asset = {
  chain: string;
  token: string;
  decimals: number;
};

export type GeneratorInput = {
  routes: RouteConfig[];
  assets: Record<string, Asset>;
  sidecarURL: string;
  upstreamURL: string;
};

export type GeneratorOutput = {
  nginxConf: string;
  luaFiles: Map<string, string>;
  warnings: string[];
};
