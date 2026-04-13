-- preamble: sidecar_url, upstream_url, capture_fields, search_keys

local fm = require("faremeter")
local cjson = require("cjson.safe")
local ws_server = require("resty.websocket.server")
local ws_client = require("resty.websocket.client")

-- Accumulated capture fields for the lifetime of the websocket
-- session. Each matching frame contributes values via
-- `fm.accumulate_fields`, which merges into this flat map rather
-- than replacing it; `deliver_capture` reconstructs the nested body
-- once at delivery time. See `fm.accumulate_fields` for the
-- multi-frame rationale.
local accumulated_fields = {}

local function matches_search_keys(data)
  if #search_keys == 0 then
    return true
  end
  -- search_keys are pre-encoded as JSON strings by the generator so
  -- the match uses the exact byte sequence a compliant JSON encoder
  -- would emit, including escape sequences for keys that contain
  -- quote, backslash, or control characters.
  for _, key in ipairs(search_keys) do
    if string.find(data, key, 1, true) then
      return true
    end
  end
  return false
end

local function extract_fields(parsed)
  fm.accumulate_fields(accumulated_fields, parsed, capture_fields)
end

local function deliver_capture()
  if not ngx.ctx.fm_paid then
    return
  end

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
  local resp_status_json = cjson.encode(ngx.ctx.fm_status or 200)
  local resp_headers_json = cjson.encode(ngx.ctx.fm_captured_headers or {})
  local resp_body_json = cjson.encode(fm.reconstruct_nested(accumulated_fields))

  if op_key_json == nil or method_json == nil or path_json == nil
      or headers_json == nil or query_json == nil or body_json == nil
      or resp_status_json == nil or resp_headers_json == nil or resp_body_json == nil then
    ngx.log(ngx.WARN, "faremeter: failed to encode ws capture payload")
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
