-- preamble: sidecar_url

local cjson = require("cjson.safe")
local fm = require("faremeter")

if not ngx.ctx.fm_paid then
  return
end

if ngx.ctx.fm_ws_handled then
  return
end

-- fm_status is set by the header-filter block when capture fields
-- exist. For one-phase rules with no response-body captures, the
-- header-filter is not emitted and fm_status is nil — fall back to
-- the upstream status directly.

-- Use the raw request body bytes stashed during the access phase so
-- the digest the sidecar computed at /request time matches the bytes
-- it receives here. Re-encoding the parsed Lua table via cjson.encode
-- does not preserve key order, which causes digest mismatches.
local body_json = ngx.ctx.fm_req_body_raw
    or cjson.encode(ngx.ctx.fm_req_body or cjson.null)

local op_key_json = cjson.encode(ngx.ctx.fm_operation_key)
local method_json = cjson.encode(ngx.ctx.fm_method)
local path_json = cjson.encode(ngx.ctx.fm_path)
local headers_json = cjson.encode(ngx.ctx.fm_req_headers)
local query_json = cjson.encode(ngx.ctx.fm_req_query)
local resp_status_json = cjson.encode(ngx.ctx.fm_status or ngx.status)
local resp_headers_json = cjson.encode(ngx.ctx.fm_captured_headers or {})
local resp_body_json = cjson.encode(ngx.ctx.fm_captured or {})

-- cjson.safe returns nil + err instead of raising on encode failures
-- (NaN, Inf, cycles). A capture payload we can't encode can't be settled,
-- so log and bail rather than crashing the log_by_lua phase.
if op_key_json == nil or method_json == nil or path_json == nil
    or headers_json == nil or query_json == nil or body_json == nil
    or resp_status_json == nil or resp_headers_json == nil or resp_body_json == nil then
  ngx.log(ngx.ERR, "faremeter: failed to encode capture payload")
  return
end

local json_payload = '{"operationKey":' .. op_key_json
    .. ',"method":' .. method_json
    .. ',"path":' .. path_json
    .. ',"headers":' .. headers_json
    .. ',"query":' .. query_json
    .. ',"body":' .. body_json
    .. ',"response":{"status":' .. resp_status_json
    .. ',"headers":' .. resp_headers_json
    .. ',"body":' .. resp_body_json
    .. '}}'

local capture_key = ngx.var.request_id .. ":" .. ngx.ctx.fm_operation_key

local ok, err = fm.write_capture(ngx.shared.fm_capture_buffer, capture_key, json_payload, 60)
if not ok then
  ngx.log(ngx.WARN, "faremeter: failed to write capture to shared_dict: ", err)
  return
end

local timer_ok, timer_err = ngx.timer.at(0, fm.flush_capture, capture_key, sidecar_url, ngx.shared.fm_capture_buffer)
if not timer_ok then
  ngx.log(ngx.WARN, "faremeter: failed to schedule capture flush timer: ", timer_err)
end
