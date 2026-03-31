-- preamble: capture_header_names

if not ngx.ctx.fm_paid then
  return
end

ngx.ctx.fm_status = ngx.status
ngx.ctx.fm_captured = {}
ngx.ctx.fm_captured_headers = {}

local ct = ngx.header["Content-Type"] or ""
if ct:find("text/event%-stream") then
  ngx.ctx.fm_is_sse = true
  ngx.var.proxy_buffering = "off"
else
  ngx.ctx.fm_is_sse = false
end

if capture_header_names and #capture_header_names > 0 then
  local headers = ngx.resp.get_headers()
  for _, name in ipairs(capture_header_names) do
    ngx.ctx.fm_captured_headers[name] = headers[name]
  end
end
