# Gateway Architecture

The nginx gateway is a generated OpenResty configuration that intercepts HTTP traffic, enforces payment via a sidecar process, and captures response data for settlement. The generator produces nginx location blocks and a Lua module from an OpenAPI spec with `x-faremeter-pricing` extensions. The operator provides the outer nginx.conf (worker config, http block, server blocks, TLS, etc.) and includes the generated locations.

## Components

```
                                 +-----------+
                                 |  sidecar  |
                                 +-----------+
                                   ^   |
                          /request |   | JSON response
                         /response |   v
+--------+    +-------------------+----------+    +-----------+
| client | -> |       nginx (OpenResty)      | -> | upstream  |
+--------+ <- |   Lua phases: access,        | <- | (your API)|
              |   header-filter, body-filter,|    +-----------+
              |   log, content (WebSocket)   |
              +------------------------------+
```

**nginx** handles TLS termination, routing, and proxying. Each priced endpoint gets Lua code injected into nginx's request processing phases. The Lua code is stateless -- all pricing logic lives in the sidecar.

**sidecar** is a lightweight HTTP server that evaluates pricing rules and talks to payment facilitators. It exposes two endpoints: `/request` and `/response`. The sidecar is the only component that imports the pricing evaluator and payment middleware.

**upstream** is the API being monetized. It knows nothing about payments. nginx proxies to it after the sidecar approves the request.

## Nginx Phases

Each priced HTTP endpoint gets Lua code in up to four nginx phases. The phases run in order for every request:

### access_by_lua_block

Runs before nginx proxies to the upstream. Reads the request body, headers, query params, and method. Sends them to the sidecar's `/request` endpoint. The sidecar evaluates pricing rules and either:

- Returns `200` with an empty body (payment verified or settled, proceed to upstream).
- Returns `200` with a non-200 `status` field in the JSON body (402 payment required, or other client error). The Lua code writes this response directly to the client and stops the request.

If the sidecar is unreachable or returns a non-200 HTTP status, the Lua code returns 502 Bad Gateway.

**Payload sent to `/request`:**

```json
{
  "operationKey": "POST /v1/chat/completions",
  "method": "POST",
  "path": "/v1/chat/completions",
  "headers": { "content-type": "application/json", ... },
  "query": { "stream": "true" },
  "body": { "model": "gpt-4o", "messages": [...] }
}
```

`body` is the parsed JSON request body, or `null` for methods that do not carry bodies (GET, HEAD, DELETE, OPTIONS). Non-JSON bodies on body-carrying methods are forwarded as `null` -- the sidecar decides whether that is an error.

Headers and query params that appear multiple times are preserved as arrays, not comma-joined.

### header_filter_by_lua_block

Runs when the upstream's response headers arrive. Records `ngx.status` into `ngx.ctx.fm_status` and captures any response headers referenced by capture expressions. Also detects SSE responses (`Content-Type: text/event-stream`) and sets a flag for the body filter.

Only emitted when the pricing rules reference response fields. Endpoints with capture-only rules (no `$.response.*` references) skip this phase.

### body_filter_by_lua_block

Runs for each chunk of the upstream response body. Behavior depends on transport type:

- **JSON**: Accumulates chunks until EOF, then parses the full body and extracts capture fields.
- **SSE**: Parses each SSE event individually. Capture fields accumulate across events using a flat map (`fm.accumulate_fields`), so fields from different events merge rather than overwrite.

Capture fields are JSONPath-derived paths like `usage.total_tokens` that the generator pre-computes from the spec's `$.response.body.*` references. A search-key optimization skips parsing chunks that cannot contain relevant fields.

A 1 MiB cap on accumulated body bytes prevents unbounded memory growth. Requests exceeding the cap drop capture for that request (settlement still proceeds against the authorized amount).

Only emitted when the pricing rules reference response body fields. Skipped for WebSocket transport (handled in `content_by_lua_block`) and for endpoints with no response-body captures.

### log_by_lua_block

Runs after the response has been sent to the client. Assembles the full `/response` payload from `ngx.ctx` values set by earlier phases and writes it to a shared-memory dictionary (`ngx.shared.fm_capture_buffer`). Then schedules an async timer (`ngx.timer.at`) to flush the capture to the sidecar.

Always emitted for priced endpoints, even when there are no response-body captures. The sidecar needs the `/response` call to settle the payment.

**Payload sent to `/response`:**

```json
{
  "operationKey": "POST /v1/chat/completions",
  "method": "POST",
  "path": "/v1/chat/completions",
  "headers": { "content-type": "application/json", ... },
  "query": {},
  "body": { "model": "gpt-4o", "messages": [...] },
  "response": {
    "status": 200,
    "headers": { "x-ratelimit-remaining": "99" },
    "body": { "usage": { "prompt_tokens": 10, "completion_tokens": 20 } }
  }
}
```

`body` in the top-level object is the original request body (or `null` for bodyless methods). `response.body` contains only the fields extracted by the body filter -- it is not the full upstream response, just the paths the capture expression references. `response.status` falls back to `ngx.status` when the header filter was not emitted (capture-only rules with no `$.response.*` references).

### content_by_lua_block (WebSocket only)

Replaces `proxy_pass` for WebSocket endpoints. Handles the full lifecycle:

1. Accepts the WebSocket upgrade from the client.
2. Connects to the upstream via WebSocket (http scheme converted to ws).
3. Spawns two relay threads: client-to-upstream and upstream-to-client.
4. On each upstream text frame, checks for capture-field keywords and extracts fields (same accumulation as the SSE body filter).
5. On connection close, calls `deliver_capture` which writes to the shared dict and schedules the async flush, same as the log phase.

Binary frames and pings are relayed without inspection.

## Retry and Error Handling

The `/response` POST is asynchronous -- it runs in an `ngx.timer.at` callback after the client response is already sent. If the sidecar returns a non-2xx status, the flush retries with exponential backoff (1s, 2s, 4s) up to 3 attempts. The capture payload is held in `ngx.shared.fm_capture_buffer` with a 60-second TTL.

The sidecar returns different status codes for different failure modes:

| Status | Meaning                                                         | Lua behavior                                      |
| ------ | --------------------------------------------------------------- | ------------------------------------------------- |
| 200    | Settlement succeeded                                            | Delete capture buffer                             |
| 422    | Capture expression failed (missing field, negative coefficient) | Retry (may be transient if upstream shape varies) |
| 500    | Sidecar internal error (validation failure, unexpected crash)   | Retry                                             |

## Config Generation

The generator reads an OpenAPI spec with `x-faremeter-pricing` extensions and produces:

- `locations.conf` -- nginx location blocks with embedded Lua for each priced endpoint. The operator includes this inside their own `server { }` block.
- `faremeter.lua` -- shared Lua module (`require("faremeter")`) containing helpers for field extraction, SSE parsing, capture accumulation, sidecar communication, and retry logic. Identical across sites in a multi-site deployment.
- `openapi.yaml` -- copy of the spec for the `.well-known/openapi.yaml` endpoint (optional, controlled by `specRoot`).

The operator provides the outer nginx.conf with `worker_processes`, `events`, `http` block, `lua_package_path`, `lua_shared_dict`, and `server` blocks. The generator does not emit any of these — it only produces the location blocks that go inside the operator's server block.

The generator also analyzes each pricing rule's capture expressions to determine:

- Which `$.response.body.*` fields to extract (drives body-filter and search-key generation).
- Which `$.response.headers.*` fields to capture (drives header-filter generation).
- Whether any capture fields exist at all (determines whether header-filter and body-filter phases are emitted).
- The transport type (json, sse, websocket) from the OpenAPI operation's content types and parameters.

Paths with both HTTP and WebSocket operations on the same path get a combined location block with `Upgrade` header detection that redirects WebSocket requests to a named internal location.

## Shared State

Per-request state flows through `ngx.ctx`:

| Key                   | Set by        | Used by                                    | Description                                                |
| --------------------- | ------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `fm_paid`             | access        | header-filter, body-filter, log, websocket | Whether the sidecar approved the request                   |
| `fm_operation_key`    | access        | log, websocket                             | Operation identifier (e.g. `POST /v1/chat/completions`)    |
| `fm_method`           | access        | log, websocket                             | HTTP method                                                |
| `fm_path`             | access        | log, websocket                             | Request path                                               |
| `fm_req_headers`      | access        | log, websocket                             | Request headers (preserved as-is, including arrays)        |
| `fm_req_query`        | access        | log, websocket                             | Query parameters                                           |
| `fm_req_body`         | access        | log, websocket                             | Parsed request body (or nil for bodyless methods)          |
| `fm_status`           | header-filter | log                                        | Upstream response status code                              |
| `fm_is_sse`           | header-filter | body-filter                                | Whether the response is SSE                                |
| `fm_captured`         | body-filter   | log                                        | Extracted response body fields (nested)                    |
| `fm_captured_flat`    | body-filter   | body-filter                                | Flat accumulator for multi-event capture                   |
| `fm_captured_headers` | header-filter | log                                        | Extracted response headers                                 |
| `fm_body_chunks`      | body-filter   | body-filter                                | Buffered body chunks (non-SSE)                             |
| `fm_body_bytes`       | body-filter   | body-filter                                | Running byte count for overflow detection                  |
| `fm_body_overflow`    | body-filter   | body-filter                                | Whether the body exceeded the 1 MiB cap                    |
| `fm_line_buffer`      | body-filter   | body-filter                                | SSE line parser state across chunks                        |
| `fm_ws_handled`       | websocket     | log                                        | Prevents log phase from double-flushing WebSocket captures |

Cross-request state uses `ngx.shared.fm_capture_buffer`, a shared-memory dictionary configured in the nginx `http` block. Each capture is keyed by `request_id:operation_key` with a 60-second TTL.
