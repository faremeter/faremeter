-- preamble: sidecar_url

local fm = require("faremeter")

if not ngx.ctx.fm_paid then
  return
end

if ngx.ctx.fm_ws_handled then
  return
end

local payload = {
  operationKey = ngx.ctx.fm_operation_key,
  method = ngx.ctx.fm_method,
  path = ngx.ctx.fm_path,
  headers = ngx.ctx.fm_req_headers,
  query = ngx.ctx.fm_req_query,
  body = ngx.ctx.fm_req_body,
  response = {
    status = ngx.ctx.fm_status,
    headers = ngx.ctx.fm_captured_headers or {},
    body = ngx.ctx.fm_captured or {},
  },
}

local cjson = require("cjson")
local json_payload = cjson.encode(payload)

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
