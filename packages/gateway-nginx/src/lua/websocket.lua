-- preamble: sidecar_url, upstream_url, capture_fields, search_keys

local fm = require("faremeter")
local cjson = require("cjson.safe")
local ws_server = require("resty.websocket.server")
local ws_client = require("resty.websocket.client")

local captured = {}

local function matches_search_keys(data)
  if #search_keys == 0 then
    return true
  end
  for _, key in ipairs(search_keys) do
    if string.find(data, '"' .. key .. '"', 1, true) then
      return true
    end
  end
  return false
end

local function extract_fields(parsed)
  local flat = {}
  for _, path in ipairs(capture_fields) do
    flat[path] = fm.extract_field(parsed, path)
  end
  captured = fm.reconstruct_nested(flat)
end

local function deliver_capture()
  if not ngx.ctx.fm_paid then
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
      status = ngx.ctx.fm_status or 200,
      headers = ngx.ctx.fm_captured_headers or {},
      body = captured,
    },
  }

  local json_payload = cjson.encode(payload)
  local capture_key = ngx.var.request_id .. ":" .. ngx.ctx.fm_operation_key
  local ok, err = fm.write_capture(ngx.shared.fm_capture_buffer, capture_key, json_payload, 60)
  if not ok then
    ngx.log(ngx.WARN, "faremeter: failed to write ws capture to shared_dict: ", err)
    return
  end

  local timer_ok, timer_err = ngx.timer.at(0, fm.flush_capture, capture_key, sidecar_url, ngx.shared.fm_capture_buffer)
  if not timer_ok then
    ngx.log(ngx.WARN, "faremeter: failed to schedule ws capture flush timer: ", timer_err)
  end

  ngx.ctx.fm_ws_handled = true
end

local client, err = ws_server:new()
if not client then
  ngx.log(ngx.ERR, "faremeter: failed to create websocket server: ", err)
  return ngx.exit(444)
end

local upstream, up_err = ws_client:new()
if not upstream then
  ngx.log(ngx.ERR, "faremeter: failed to create websocket client: ", up_err)
  client:send_close(1011, "internal error")
  deliver_capture()
  return
end

local up_ok, up_connect_err = upstream:connect(upstream_url .. ngx.var.uri)
if not up_ok then
  ngx.log(ngx.ERR, "faremeter: failed to connect to upstream websocket: ", up_connect_err)
  client:send_close(1011, "internal error")
  deliver_capture()
  return
end

local function relay_upstream_to_client()
  while true do
    local data, typ, frame_err = upstream:recv_frame()
    if not data then
      if not frame_err then
        break
      end
      ngx.log(ngx.ERR, "faremeter: upstream ws recv error: ", frame_err)
      break
    end

    if typ == "close" then
      client:send_close(1000, data)
      break
    elseif typ == "ping" then
      local _, send_err = client:send_pong(data)
      if send_err then
        ngx.log(ngx.ERR, "faremeter: failed to send pong to client: ", send_err)
        break
      end
    elseif typ == "pong" then
      -- ignore upstream pong
    elseif typ == "text" then
      if ngx.ctx.fm_paid and #capture_fields > 0 then
        if matches_search_keys(data) then
          local parsed_ok, parsed = pcall(cjson.decode, data)
          if parsed_ok and parsed then
            extract_fields(parsed)
          end
        end
      end
      local _, send_err = client:send_text(data)
      if send_err then
        ngx.log(ngx.ERR, "faremeter: failed to relay text to client: ", send_err)
        break
      end
    elseif typ == "binary" then
      local _, send_err = client:send_binary(data)
      if send_err then
        ngx.log(ngx.ERR, "faremeter: failed to relay binary to client: ", send_err)
        break
      end
    end
  end
end

local function relay_client_to_upstream()
  while true do
    local data, typ, frame_err = client:recv_frame()
    if not data then
      if not frame_err then
        break
      end
      ngx.log(ngx.ERR, "faremeter: client ws recv error: ", frame_err)
      break
    end

    if typ == "close" then
      upstream:send_close(1000, data)
      break
    elseif typ == "ping" then
      local _, send_err = upstream:send_pong(data)
      if send_err then
        ngx.log(ngx.ERR, "faremeter: failed to send pong to upstream: ", send_err)
        break
      end
    elseif typ == "pong" then
      -- ignore client pong
    elseif typ == "text" then
      local _, send_err = upstream:send_text(data)
      if send_err then
        ngx.log(ngx.ERR, "faremeter: failed to relay text to upstream: ", send_err)
        break
      end
    elseif typ == "binary" then
      local _, send_err = upstream:send_binary(data)
      if send_err then
        ngx.log(ngx.ERR, "faremeter: failed to relay binary to upstream: ", send_err)
        break
      end
    end
  end
end

local up_thread = ngx.thread.spawn(relay_upstream_to_client)
local client_thread = ngx.thread.spawn(relay_client_to_upstream)

local ok1, res1 = ngx.thread.wait(up_thread, client_thread)

if ok1 then
  if coroutine.status(up_thread) == "running" or coroutine.status(up_thread) == "suspended" then
    ngx.thread.kill(up_thread)
  end
  if coroutine.status(client_thread) == "running" or coroutine.status(client_thread) == "suspended" then
    ngx.thread.kill(client_thread)
  end
else
  ngx.log(ngx.ERR, "faremeter: websocket relay thread failed: ", res1)
  ngx.thread.kill(up_thread)
  ngx.thread.kill(client_thread)
end

upstream:send_close()
client:send_close()
deliver_capture()
