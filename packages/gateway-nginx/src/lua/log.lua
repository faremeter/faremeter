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
local payload = {
  operationKey = ngx.ctx.fm_operation_key,
  method = ngx.ctx.fm_method,
  path = ngx.ctx.fm_path,
  headers = ngx.ctx.fm_req_headers,
  query = ngx.ctx.fm_req_query,
  body = ngx.ctx.fm_req_body or cjson.null,
  response = {
    status = ngx.ctx.fm_status or ngx.status,
    headers = ngx.ctx.fm_captured_headers or {},
    body = ngx.ctx.fm_captured or {},
  },
}

-- cjson.safe returns nil + err instead of raising on encode failures
-- (NaN, Inf, cycles). A capture payload we can't encode can't be settled,
-- so log and bail rather than crashing the log_by_lua phase.
local json_payload, encode_err = cjson.encode(payload)
if not json_payload then
  ngx.log(ngx.ERR, "faremeter: failed to encode capture payload: ", encode_err)
  return
end

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
