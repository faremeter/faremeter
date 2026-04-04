export type Asset = {
  chain: string;
  token: string;
  decimals: number;
  recipient: string;
};

export type Rates = Record<string, number>;

export type PricingRule = {
  match: string;
  authorize?: string;
  capture: string;
};

export type OperationPricing = {
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
};
