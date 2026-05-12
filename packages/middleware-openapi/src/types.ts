import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { MPPMethodHandler } from "@faremeter/types/mpp";

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

/**
 * The shape of an operation the gateway protects. Carries only the
 * routing fields (method, path, transport); pricing rules live on the
 * handler bindings, not on the spec.
 *
 * The spec is the orientation document — "these are the operations we
 * serve and how requests/responses are shaped." Pricing semantics
 * ("how do we charge for settlement through handler X") belong on
 * the binding because they cannot exist independently of which
 * handler is settling.
 */
export type OperationShape = {
  method: string;
  path: string;
  transport: TransportType;
};

/**
 * Operation-level pricing on a single handler binding. A binding's
 * `rates` and `rules` apply only to settlement through that binding's
 * handler — sibling bindings can declare different rules for the same
 * operation without any cross-talk.
 */
export type BindingPricing = {
  rates?: Rates;
  rules?: PricingRule[];
};

export type FaremeterSpec = {
  assets: Record<string, Asset>;
  operations: Record<string, OperationShape>;
};

/**
 * An x402 handler bound to its own per-operation pricing. The handler's
 * `capabilities.schemes` determines which payment payloads this binding
 * serves; the `operations` map says how settlement is priced for each.
 *
 * Operations not listed in `operations` are not served by this binding —
 * the gateway will simply not advertise this handler's schemes for those
 * operations.
 */
export type HandlerBinding = {
  handler: FacilitatorHandler;
  operations: Record<string, BindingPricing>;
};

/**
 * An MPP method handler bound to its own per-operation pricing. Same
 * structure as {@link HandlerBinding} but for MPP-protocol handlers.
 */
export type MPPBinding = {
  handler: MPPMethodHandler;
  operations: Record<string, BindingPricing>;
};

/**
 * Result of parsing an OpenAPI document. The spec carries operation
 * shapes; pricing extracted from `x-faremeter-pricing` extensions is
 * returned separately as a per-operation default that callers can
 * apply to whichever bindings they construct.
 *
 * Pre-binding refactor, the parser folded rates and rules into
 * operations directly. That coupled spec shape to handler-specific
 * settlement concerns, which is exactly what the binding model is
 * meant to undo — so callers now pair `defaultPricing` with handlers
 * explicitly to form {@link HandlerBinding}s.
 */
export type LoadedSpec = {
  spec: FaremeterSpec;
  defaultPricing: Record<string, BindingPricing>;
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

export type PhaseTrace = {
  bindings: Record<string, unknown>;
  coefficient: number;
};

export type EvalTrace = {
  ruleIndex: number;
  rule: PricingRule;
  authorize?: PhaseTrace;
  capture: PhaseTrace;
};

export type PriceResult = {
  matched: boolean;
  amount: Record<string, bigint>;
  // True when the matched rule has an explicit `authorize`
  // expression. When false, the authorize result was derived from
  // the `capture` expression and the handler settles at /request
  // instead of deferring to /response.
  hasAuthorize?: boolean;
  ruleIndex?: number;
  rule?: PricingRule;
  trace?: PhaseTrace;
};
