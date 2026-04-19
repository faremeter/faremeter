-- preamble: op_keys, sidecar_url

local cjson = require("cjson.safe")
local fm = require("faremeter")

local function bad_gateway(msg)
  ngx.log(ngx.ERR, "faremeter: ", msg)
  ngx.status = 502
  ngx.say('{"error":"bad gateway"}')
  return ngx.exit(502)
end

local method = ngx.req.get_method()
local op_key = op_keys[method]
if not op_key then
  return
end

-- ngx.req.read_body() can raise on oversize bodies or disk-spool failures;
-- guard it so a 413/IO error becomes a clean 502 instead of an uncaught
-- Lua error that bubbles out of access_by_lua_block.
local read_ok, read_err = pcall(ngx.req.read_body)
if not read_ok then
  return bad_gateway("ngx.req.read_body failed: " .. tostring(read_err))
end

local raw_body = ngx.req.get_body_data()
if not raw_body then
  local file = ngx.req.get_body_file()
  if file then
    local fh, open_err = io.open(file, "r")
    if not fh then
      return bad_gateway(
        "failed to read request body file: " .. tostring(open_err)
      )
    end
    raw_body = fh:read("*a")
    fh:close()
  end
end

-- Decode once and keep the parsed table so we don't pay the cost twice.
--
-- `raw_body` can be nil (no body was sent, typical for GET/HEAD/
-- DELETE/OPTIONS) or non-JSON (client sent binary or malformed
-- JSON on a body-carrying method). Both cases forward `null` to
-- the sidecar: the handler treats `null + bodyless method` as an
-- empty object for evaluation, and rejects `null + body-carrying
-- method` as a client error.
local parsed_body = nil
if raw_body then
  local decoded, decode_err = cjson.decode(raw_body)
  if decoded == nil and decode_err then
    raw_body = "null"
  else
    parsed_body = decoded
  end
else
  raw_body = "null"
end

-- Preserve multi-value headers and query params as JSON arrays rather than
-- lossy comma joins (RFC 7230 §3.2.2 permits commas inside cookie values).
local function array_aware(tbl)
  local result = {}
  for k, v in pairs(tbl) do
    result[k] = v
  end
  return result
end

local headers = array_aware(ngx.req.get_headers())
headers["x-request-id"] = ngx.var.request_id
local query = array_aware(ngx.req.get_uri_args())

-- Each cjson.safe.encode can return nil on failure (NaN, Inf, cycles).
-- We check each call site eagerly rather than post-building a table;
-- ipairs over a sparse table stops at the first nil so it could not
-- surface a failure through a single iteration loop.
local op_key_json = cjson.encode(op_key)
local path_json = cjson.encode(ngx.var.uri)
local method_json = cjson.encode(method)
local headers_json = cjson.encode(headers)
local query_json = cjson.encode(query)
if op_key_json == nil or path_json == nil or method_json == nil
  or headers_json == nil or query_json == nil then
  return bad_gateway("failed to encode sidecar payload")
end
local payload = '{"operationKey":' .. op_key_json
  .. ',"path":' .. path_json
  .. ',"method":' .. method_json
  .. ',"body":' .. raw_body
  .. ',"headers":' .. headers_json
  .. ',"query":' .. query_json
  .. '}'

local res, err = fm.post_to_sidecar(sidecar_url .. "/request", payload)
if not res then
  return bad_gateway("sidecar request failed: " .. tostring(err))
end

if res.status ~= 200 then
  return bad_gateway("sidecar returned HTTP " .. tostring(res.status))
end

local gateway, decode_err = cjson.decode(res.body)
if not gateway then
  return bad_gateway("sidecar returned invalid JSON: " .. tostring(decode_err))
end

if not gateway.status then
  return bad_gateway("sidecar response missing status field")
end

local client_status = gateway.status

if client_status ~= 200 then
  ngx.status = client_status
  if gateway.headers then
    for k, v in pairs(gateway.headers) do
      ngx.header[k] = v
    end
  end
  if gateway.body then
    local encoded = cjson.encode(gateway.body)
    if encoded then
      ngx.say(encoded)
    else
      ngx.log(ngx.ERR,
        "faremeter: failed to encode gateway response body for client")
    end
  end
  return ngx.exit(client_status)
end

-- On the 200 path (payment verified) any sidecar-supplied headers are
-- propagated to the client-facing response, not upstream. If upstream
-- visibility is ever needed, use ngx.req.set_header here instead.
if gateway.headers then
  for k, v in pairs(gateway.headers) do
    ngx.header[k] = v
  end
end
ngx.ctx.fm_paid = true
ngx.ctx.fm_operation_key = op_key
ngx.ctx.fm_method = method
ngx.ctx.fm_path = ngx.var.uri
ngx.ctx.fm_req_headers = headers
ngx.ctx.fm_req_query = query
ngx.ctx.fm_req_body = parsed_body
ngx.ctx.fm_req_body_raw = raw_body
