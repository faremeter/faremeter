-- preamble: op_keys, sidecar_url

local cjson = require("cjson")
local fm = require("faremeter")

local method = ngx.req.get_method()
local op_key = op_keys[method]
if not op_key then
  return
end

ngx.req.read_body()
local raw_body = ngx.req.get_body_data()
if not raw_body then
  local file = ngx.req.get_body_file()
  if file then
    local fh = io.open(file, "r")
    if fh then
      raw_body = fh:read("*a")
      fh:close()
    end
  end
end

if raw_body then
  local ok = pcall(cjson.decode, raw_body)
  if not ok then
    raw_body = "null"
  end
else
  raw_body = "null"
end

local function flatten_values(tbl)
  local flat = {}
  for k, v in pairs(tbl) do
    if type(v) == "table" then
      flat[k] = table.concat(v, ", ")
    else
      flat[k] = v
    end
  end
  return flat
end

local headers = flatten_values(ngx.req.get_headers())
local query = flatten_values(ngx.req.get_uri_args())

local payload = '{"operationKey":' .. cjson.encode(op_key)
  .. ',"path":' .. cjson.encode(ngx.var.uri)
  .. ',"method":' .. cjson.encode(method)
  .. ',"body":' .. raw_body
  .. ',"headers":' .. cjson.encode(headers)
  .. ',"query":' .. cjson.encode(query)
  .. '}'

local res, err = fm.post_to_sidecar(sidecar_url .. "/request", payload)
if not res then
  ngx.log(ngx.ERR, "sidecar request failed: ", err)
  ngx.status = 502
  ngx.say('{"error":"bad gateway"}')
  return ngx.exit(502)
end

if res.status ~= 200 then
  ngx.log(ngx.ERR, "sidecar returned HTTP ", res.status)
  ngx.status = 502
  ngx.say('{"error":"bad gateway"}')
  return ngx.exit(502)
end

local ok, gateway = pcall(cjson.decode, res.body)
if not ok or not gateway then
  ngx.log(ngx.ERR, "sidecar returned invalid JSON")
  ngx.status = 502
  ngx.say('{"error":"bad gateway"}')
  return ngx.exit(502)
end

if not gateway.status then
  ngx.log(ngx.ERR, "sidecar response missing status field")
  ngx.status = 502
  ngx.say('{"error":"bad gateway"}')
  return ngx.exit(502)
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
    ngx.say(cjson.encode(gateway.body))
  end
  return ngx.exit(client_status)
end

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
ngx.ctx.fm_req_body = raw_body and cjson.decode(raw_body) or nil
