export type Asset = {
  chain: string;
  token: string;
  decimals: number;
  recipient: string;
};

/**
 * Per-asset pricing rates. Each value is the number of atomic asset units
 * charged per 1.0 of the rule's evaluated coefficient. Modelled as `bigint`
 * because atomic units flow directly to on-chain settlement and must not
 * lose precision to IEEE-754 rounding.
 */
export type Rates = Record<string, bigint>;

export type PricingRule = {
  match: string;
  authorize?: string;
  capture: string;
};

export type TransportType = "json" | "sse" | "websocket";

export type OperationPricing = {
  method: string;
  path: string;
  transport: TransportType;
  rates?: Rates;
  rules?: PricingRule[] | undefined;
};

export type FaremeterSpec = {
  assets: Record<string, Asset>;
  operations: Record<string, OperationPricing>;
};

export type EvalContext = {
  request: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
    query: Record<string, string>;
    path: string;
  };
  response?: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
    status: number;
  };
};

export type PriceResult = {
  matched: boolean;
  amount: Record<string, bigint>;
  // True when the matched rule has an explicit `authorize`
  // expression. When false, the authorize result was derived from
  // the `capture` expression and the handler settles at /request
  // instead of deferring to /response.
  hasAuthorize?: boolean;
};
