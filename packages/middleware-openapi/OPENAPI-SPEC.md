# Implementation

## x-faremeter-pricing OpenAPI Extension

Pricing for paid API operations is defined declaratively inside OpenAPI 3.x specs using `x-faremeter-*` extension fields. No pricing logic lives in application code. The server loads the spec at startup, compiles and validates all expressions, and evaluates them at request time. The extension is payment-protocol agnostic -- it computes amounts but does not prescribe how payments are collected or settled.

### Standards

| Concern                | Standard                                                   |
| ---------------------- | ---------------------------------------------------------- |
| Spec envelope          | OpenAPI 3.x                                                |
| Match and extraction   | JSONPath, RFC 9535                                         |
| Regex in match filters | I-Regexp, RFC 9485 (via RFC 9535 `match()` and `search()`) |
| Arithmetic             | expr-eval (not standardized; internal to the evaluator)    |

### Extension Fields

Three extension fields are recognized. All are optional.

#### x-faremeter-assets

Defined at the document root. Declares the on-chain tokens available for payment.

```yaml
x-faremeter-assets:
  usdc-sol:
    chain: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    token: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    decimals: 6
    recipient: "RecipientWalletAddress"
```

Each entry is keyed by a logical asset name and contains:

| Field       | Type    | Description                              |
| ----------- | ------- | ---------------------------------------- |
| `chain`     | string  | CAIP-2 chain identifier                  |
| `token`     | string  | On-chain token address                   |
| `decimals`  | integer | Token decimal places                     |
| `recipient` | string  | Wallet address that receives the payment |

#### x-faremeter-pricing

Can appear at three levels in the OpenAPI document:

- **Document root** -- default rates and rules for all operations
- **Path item** -- overrides document rates/rules for all operations on that path
- **Operation** -- overrides path rates/rules for a specific HTTP method

Both `rates` and `rules` cascade through the hierarchy with nearest-wins semantics. An operation without its own `rules` inherits from the path level, then the document level. To make an individual operation free when a higher level defines rules, set `rules: []` on that operation.

```yaml
x-faremeter-pricing:
  rates:
    usdc-sol: 1
  rules:
    - match: "..."
      authorize: "..."
      capture: "..."
```

### Cascading

Both `rates` and `rules` cascade through the OpenAPI hierarchy with nearest-wins semantics:

1. If the operation defines the field, use it.
2. Otherwise, if the path item defines the field, use it.
3. Otherwise, use the document-level field.

Fields at a given level replace outer levels entirely -- they do not merge. This follows the same semantics as OpenAPI's `servers` field.

An operation can opt out of inherited rules by setting an explicit empty array: `rules: []`. This makes the operation free even though its path or document defines default rules.

### Pricing Rules

Rules are an ordered array. They are evaluated top-to-bottom; the first rule whose `match` expression produces a non-empty result wins. Subsequent rules are not evaluated.

A rule has three fields:

| Field       | Required | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| `match`     | yes      | JSONPath query that selects this rule                  |
| `authorize` | no       | Arithmetic expression computing the pre-request amount |
| `capture`   | yes      | Arithmetic expression computing the actual cost        |

The combination of `authorize` and `capture` determines the settlement timing:

- **`authorize` + `capture`**: The authorize amount is advertised as a payment requirement before the upstream request. The payment scheme places a hold for that amount. After the upstream responds, the capture expression computes the actual cost. The gateway passes the captured amount to the facilitator for settlement. The facilitator decides whether to accept it (e.g. enforce settle <= hold, allow over-spend, etc.).

- **`capture` only**: The capture expression is evaluated before the upstream request using only request data. The resulting amount is the exact price. The payment scheme settles immediately -- there is no deferred hold. The capture expression must not reference `$.response.*` fields since the response does not exist at evaluation time.

- **`authorize` only**: Invalid. Every rule must have a `capture` expression.

### Evaluation Context

Expressions are evaluated against a context object built from the HTTP request and (for capture with authorize) the upstream response:

```
{
  request: {
    body: { ... },
    headers: { ... },
    query: { ... },
    path: "/v1/chat/completions"
  },
  response: {       // only present when authorize is also defined
    body: { ... },
    headers: { ... },
    status: 200
  }
}
```

The `match` expression always runs against request data only (no response), even during the post-response evaluation pass.

### Match Expressions

A `match` expression is a JSONPath query per RFC 9535. The evaluator uses dual-context dispatch: filter expressions (`$[?...]`) are evaluated against the context wrapped in a single-element array so `@` binds to the context as a whole; bare selectors (`$.request.body.foo`) are evaluated against the unwrapped object directly.

```yaml
# Filter: equality test (evaluated against [context])
match: '$[?@.request.body.model == "gpt-4o"]'

# Filter: regex via RFC 9535 match() with I-Regexp (RFC 9485)
match: '$[?match(@.request.body.model, "claude-sonnet.*")]'

# Bare selector: catch-all ($ always returns the root, which is non-empty)
match: '$'
```

The `match()` function performs full-string matching (implicitly anchored). Use `search()` for substring matching.

Match expressions must not reference `$.response.*` or `@.response.*`. The match context contains only request data in both evaluation passes. A match filter referencing response fields would silently return zero nodes and never fire.

### Arithmetic Expressions

`authorize` and `capture` expressions are arithmetic with inline JSONPath references. The evaluator resolves JSONPath references against the (unwrapped) context, substitutes the resolved values, and evaluates the arithmetic.

```yaml
authorize: >
  (jsonSize($.request.body.messages) / 4 * 10
  + coalesce($.request.body.max_tokens, 1024) * 30)
  * 115 / 100

capture: >
  $.response.body.usage.prompt_tokens * 10
  + $.response.body.usage.completion_tokens * 30
```

JSONPath references are identified by the `$` prefix and support:

- Dot notation: `$.request.body.model`
- Dot notation with hyphens: `$.request.body.x-custom-field`
- Bracket notation for special characters: `$.request.body['some key']`

Each reference must resolve to exactly one value. A reference that resolves to zero or multiple values causes the expression to fail.

#### Operators

Standard arithmetic: `+`, `-`, `*`, `/`, `(`, `)`.

Division is floating-point. Results are converted to `bigint` via `Math.ceil` after multiplication by the asset rate, so fractional intermediate values are rounded up.

#### Custom Functions

| Function                 | Signature                          | Description                                                                                                                                                                               |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jsonSize(ref)`          | JSONPath ref -> number             | Returns `JSON.stringify(value).length`. Useful for estimating token count from request content.                                                                                           |
| `coalesce(ref, default)` | JSONPath ref, expression -> number | Returns the resolved value if present and non-null, otherwise evaluates the default. The default can be a literal, a JSONPath reference, or a nested expression including function calls. |

`coalesce` is resolved before other JSONPath references. Its fallback is parenthesized during substitution to preserve operator precedence.

#### Negative Results

If an expression evaluates to a negative number, the evaluator rejects it with an error. Negative coefficients are almost always a spec bug (e.g. a subtraction where the subtrahend exceeds the minuend on some responses). The error surfaces so the spec author can fix the expression.

### Settlement Flow

The gateway is plumbing. It computes amounts from the spec's expressions and passes them to the configured facilitator. The facilitator owns all policy decisions about settlement.

**Before the upstream request:**

1. The gateway intercepts the incoming request.
2. Builds the evaluation context from the request (body, headers, query, path).
3. Evaluates rules top-to-bottom. For the first matching rule, evaluates the `authorize` expression. If the rule has no `authorize`, the `capture` expression is evaluated instead (using request-only context).
4. The result, multiplied by the operation's rates, becomes the payment amount.
5. If no payment is present, the server returns HTTP 402 with the amount as a payment requirement. The client creates a payment for that amount and retries.
6. On retry, the gateway checks the payment with the facilitator. For rules with `authorize`, this is a verification (the facilitator confirms the payment is valid). For rules with only `capture`, this is a settlement (the payment is finalized before the upstream runs).

The `authorize` expression can only access `$.request.*` fields. It computes a ceiling -- an estimated maximum cost.

When only `capture` is present, the expression can only access `$.request.*` fields (the response does not exist yet). The resulting amount is the exact price -- there is no separate hold.

**After the upstream response:**

1. The upstream request executes.
2. The gateway builds the full evaluation context with both request and response data.
3. Re-evaluates rules using the same match logic (against request data only).
4. For the matching rule, evaluates the `capture` expression with both `$.request.*` and `$.response.*` available.
5. The result, multiplied by rates, is the actual cost.
6. The gateway passes the captured amount to the facilitator for settlement.

For rules with only `capture` (no `authorize`), settlement already happened before the upstream request. The post-response pass still evaluates capture for telemetry, but no additional settlement occurs.

### Transport Types

The evaluator detects the transport type from the OpenAPI operation:

- **json** (default): Standard request/response. The response body is buffered and parsed as JSON for capture field extraction.
- **sse**: Server-Sent Events. Detected when the response content type is `text/event-stream`. Each SSE event is parsed individually and capture fields accumulate across events.
- **websocket**: WebSocket relay. Detected when the operation declares an `Upgrade` header parameter. Each text frame from the upstream is examined for capture fields. Binary frames are relayed without inspection.

Transport type affects how the nginx gateway captures response data but does not change the pricing evaluation model.

### Validation

All expressions are validated at construction time. The evaluator:

1. Compiles each `match` expression as a JSONPath query.
2. Rejects match expressions that reference `$.response.*` or `@.response.*` (match runs against request data only).
3. Rejects `authorize` expressions that reference `$.response.*` (authorize runs before the response exists).
4. Rejects `capture` expressions that reference `$.response.*` when the rule has no `authorize` (capture runs before the response exists in this case).
5. Extracts JSONPath references from `authorize` and `capture` expressions (including inside `coalesce` fallbacks) and compiles each one.
6. Parses the arithmetic portion of each expression, including `coalesce` fallbacks that would otherwise go unchecked until runtime.
7. Rejects expressions that reference unknown functions or variables.

Invalid expressions cause the evaluator to throw with a descriptive error identifying the operation, rule index, phase, and offending expression.

### Amounts and Units

Expression results are dimensionless coefficients. The final payment amount for each asset is:

```
amount = ceil(coefficient * rate)
```

where `rate` is the asset's entry in the resolved rates map. All amounts are in base token units. For USDC with 6 decimals, 1,000,000 base units = $1.00.

### Complete Example

```yaml
openapi: "3.1.0"
info:
  title: "Inference API"
  version: "1.0.0"

x-faremeter-assets:
  usdc-sol:
    chain: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    token: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    decimals: 6
    recipient: "RecipientWalletAddress"

x-faremeter-pricing:
  rates:
    usdc-sol: 1

paths:
  /v1/chat/completions:
    post:
      x-faremeter-pricing:
        rules:
          # Model-specific pricing with authorize + capture
          - match: '$[?@.request.body.model == "gpt-4o"]'
            authorize: >
              (jsonSize($.request.body.messages) / 4 * 10
              + coalesce($.request.body.max_tokens, 1024) * 30)
              * 115 / 100
            capture: >
              $.response.body.usage.prompt_tokens * 10
              + $.response.body.usage.completion_tokens * 30

          - match: '$[?match(@.request.body.model, "claude-sonnet.*")]'
            authorize: >
              (jsonSize($.request.body.messages) * 12 / 4
              + coalesce($.request.body.max_tokens, 1024) * 60)
              * 125 / 100
            capture: >
              $.response.body.usage.prompt_tokens * 12
              + $.response.body.usage.completion_tokens * 60

          # Catch-all with authorize + capture
          - match: "$"
            authorize: >
              (jsonSize($.request.body.messages) / 4 * 10
              + coalesce($.request.body.max_tokens, 1024) * 40)
              * 120 / 100
            capture: >
              $.response.body.usage.prompt_tokens * 10
              + $.response.body.usage.completion_tokens * 40

  /v1/images/generations:
    post:
      x-faremeter-pricing:
        rules:
          # Capture-only: flat fee settled before the upstream runs
          - match: "$"
            capture: "1"
```

The authorize expressions estimate cost from input size and a default max output. The 115/100 and similar multipliers add a buffer to account for estimation error. The capture expressions compute exact cost from actual token usage reported in the response.

The images endpoint uses capture-only pricing: every request costs 1 unit, settled immediately. No authorize hold, no response-based metering.
