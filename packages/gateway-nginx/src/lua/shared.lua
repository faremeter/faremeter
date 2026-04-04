local _M = {}

local cjson = require("cjson")
local http = require("resty.http")

-- Navigate a nested table by a dot/bracket field path, returning nil
-- if any intermediate key is absent. Supports "usage.prompt_tokens"
-- and "['some.key']" bracket notation.
local function parse_field_segments(fieldpath)
  local segments = {}
  local i = 1
  local len = #fieldpath
  while i <= len do
    if fieldpath:sub(i, i) == "[" and fieldpath:sub(i + 1, i + 1) == "'" then
      local close = fieldpath:find("']", i + 2, true)
      if not close then
        return nil
      end
      segments[#segments + 1] = fieldpath:sub(i + 2, close - 1)
      i = close + 2
      if i <= len and fieldpath:sub(i, i) == "." then
        i = i + 1
      end
    elseif fieldpath:sub(i, i) == "[" then
      local close = fieldpath:find("]", i + 1, true)
      if not close then
        return nil
      end
      local idx = tonumber(fieldpath:sub(i + 1, close - 1))
      if idx then
        segments[#segments + 1] = idx + 1
      end
      i = close + 1
      if i <= len and fieldpath:sub(i, i) == "." then
        i = i + 1
      end
    else
      local dot = fieldpath:find(".", i, true)
      local bracket = fieldpath:find("[", i, true)
      local seg_end
      if dot and bracket then
        seg_end = math.min(dot, bracket) - 1
      elseif dot then
        seg_end = dot - 1
      elseif bracket then
        seg_end = bracket - 1
      else
        seg_end = len
      end
      if seg_end >= i then
        segments[#segments + 1] = fieldpath:sub(i, seg_end)
      end
      i = seg_end + 1
      if i <= len and fieldpath:sub(i, i) == "." then
        i = i + 1
      end
    end
  end
  return segments
end

function _M.extract_field(obj, fieldpath)
  if obj == nil then
    return nil
  end
  local segments = parse_field_segments(fieldpath)
  if not segments then
    return nil
  end
  local current = obj
  for _, seg in ipairs(segments) do
    if type(current) ~= "table" then
      return nil
    end
    current = current[seg]
    if current == nil then
      return nil
    end
  end
  return current
end

function _M.reconstruct_nested(flat)
  local result = {}
  for path, value in pairs(flat) do
    local segments = parse_field_segments(path)
    if segments and #segments > 0 then
      local current = result
      for i = 1, #segments - 1 do
        local seg = segments[i]
        if type(current[seg]) ~= "table" then
          current[seg] = {}
        end
        current = current[seg]
      end
      current[segments[#segments]] = value
    end
  end
  return result
end

function _M.post_to_sidecar(url, payload)
  local httpc = http.new()
  httpc:set_timeouts(5000, 5000, 5000)

  local res, err = httpc:request_uri(url, {
    method = "POST",
    body = payload,
    headers = {
      ["Content-Type"] = "application/json",
    },
  })

  if not res then
    return nil, err
  end

  return { status = res.status, body = res.body, headers = res.headers }
end

function _M.write_capture(dict, key, data, ttl)
  local ok, err = dict:set(key, data, ttl)
  if not ok then
    ngx.log(ngx.WARN, "faremeter: shared_dict set failed for key ", key, ": ", err)
    return false
  end
  return true
end

function _M.flush_capture(premature, key, sidecar_url, dict, attempt)
  if premature then
    return
  end

  attempt = attempt or 1
  local max_attempts = 3

  local json_data = dict:get(key)
  if not json_data then
    return
  end

  local res, err = _M.post_to_sidecar(sidecar_url .. "/response", json_data)

  if res and res.status >= 200 and res.status < 300 then
    dict:delete(key)
    return
  end

  local msg = err or ("HTTP " .. tostring(res and res.status or "unknown"))
  ngx.log(ngx.WARN, "faremeter: capture POST failed for key ", key, ": ", msg, " (attempt ", attempt, "/", max_attempts, ")")

  if attempt < max_attempts then
    local delay = math.pow(2, attempt - 1)
    local ok, timer_err = ngx.timer.at(delay, _M.flush_capture, key, sidecar_url, dict, attempt + 1)
    if not ok then
      ngx.log(ngx.WARN, "faremeter: failed to schedule capture retry timer for key ", key, ": ", timer_err)
    end
  end
end

function _M.parse_sse_chunk(buffer, chunk)
  local events = {}
  local raw = (buffer.partial_line or "") .. chunk
  local lines = {}
  local pos = 1

  while pos <= #raw do
    local nl = raw:find("\n", pos, true)
    if not nl then
      buffer.partial_line = raw:sub(pos)
      break
    end
    local line = raw:sub(pos, nl - 1)
    if line:sub(-1) == "\r" then
      line = line:sub(1, -2)
    end
    lines[#lines + 1] = line
    pos = nl + 1
    if pos > #raw then
      buffer.partial_line = ""
    end
  end

  if buffer.partial_line == nil then
    buffer.partial_line = ""
  end

  buffer.data_lines = buffer.data_lines or {}

  for _, line in ipairs(lines) do
    if line == "" then
      if #buffer.data_lines > 0 then
        local data = table.concat(buffer.data_lines, "\n")
        events[#events + 1] = data
        buffer.data_lines = {}
      end
    elseif line:sub(1, 1) == ":" then
      -- comment, skip
    elseif line:sub(1, 5) == "data:" then
      local value = line:sub(6)
      if value:sub(1, 1) == " " then
        value = value:sub(2)
      end
      buffer.data_lines[#buffer.data_lines + 1] = value
    else
      -- event:, id:, retry:, or unknown fields: skip
    end
  end

  return events, buffer
end

return _M
