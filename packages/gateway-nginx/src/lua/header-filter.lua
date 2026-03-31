-- preamble: capture_header_names

local fm = require("faremeter")

if not ngx.ctx.fm_paid then
  return
end

ngx.ctx.fm_status = ngx.status
ngx.ctx.fm_captured = {}
ngx.ctx.fm_captured_headers = {}

-- proxy_buffering is decided by the upstream module before
-- header_filter_by_lua runs, so setting ngx.var.proxy_buffering here
-- would have no effect on the current request. For SSE streaming the
-- location block emits a literal `proxy_buffering off;` at config load
-- time (see nginx/location.ts). We only record the transport type in
-- ngx.ctx so body_filter_by_lua can dispatch between SSE and buffered
-- paths.
--
-- `fm.is_sse_content_type` handles both the common string case and
-- the table case (`ngx.header["Content-Type"]` returns a table when
-- the header is set multiple times). An unguarded `ct:lower()` throws
-- on the table case and aborts the filter phase.
ngx.ctx.fm_is_sse = fm.is_sse_content_type(ngx.header["Content-Type"])

if capture_header_names and #capture_header_names > 0 then
  local headers = ngx.resp.get_headers()
  for _, name in ipairs(capture_header_names) do
    ngx.ctx.fm_captured_headers[name] = headers[name]
  end
end
