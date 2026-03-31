local _M = {}

local http = require("resty.http")

-- Navigate a nested table by a dot/bracket field path. Supports
-- "usage.prompt_tokens" dot notation, "['some.key']" single-quoted
-- bracket notation, and "[0]" numeric-index bracket notation.
--
-- Returns a list of segments on success, or `nil, err` on any parse
-- failure. Silent drops are a defensive-coding no-no: callers must
-- propagate or surface the error.
local function parse_field_segments(fieldpath)
  local segments = {}
  local i = 1
  local len = #fieldpath
  while i <= len do
    if fieldpath:sub(i, i) == "[" and fieldpath:sub(i + 1, i + 1) == "'" then
      local close = fieldpath:find("']", i + 2, true)
      if not close then
        return nil, "unterminated quoted bracket at position " .. i
      end
      segments[#segments + 1] = fieldpath:sub(i + 2, close - 1)
      i = close + 2
      if i <= len and fieldpath:sub(i, i) == "." then
        i = i + 1
      end
    elseif fieldpath:sub(i, i) == "[" then
      local close = fieldpath:find("]", i + 1, true)
      if not close then
        return nil, "unterminated bracket at position " .. i
      end
      local raw_idx = fieldpath:sub(i + 1, close - 1)
      local idx = tonumber(raw_idx)
      if not idx then
        return nil, "non-numeric unquoted bracket segment '" .. raw_idx .. "'"
      end
      if idx ~= math.floor(idx) then
        return nil, "non-integer bracket index '" .. raw_idx .. "'"
      end
      segments[#segments + 1] = idx + 1
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

_M.parse_field_segments = parse_field_segments

function _M.extract_field(obj, fieldpath)
  if obj == nil then
    return nil
  end
  local segments, parse_err = parse_field_segments(fieldpath)
  if not segments then
    ngx.log(ngx.ERR, "faremeter: invalid field path '", fieldpath, "': ", parse_err)
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
    local segments, parse_err = parse_field_segments(path)
    if not segments then
      ngx.log(ngx.ERR, "faremeter: invalid reconstruction path '", path, "': ", parse_err)
    elseif #segments > 0 then
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
    -- `^` is the canonical exponent operator across Lua 5.1-5.4 and LuaJIT.
    -- `math.pow` is deprecated in LuaJIT 2.1 and removed in Lua 5.3+.
    local delay = 2 ^ (attempt - 1)
    local ok, timer_err = ngx.timer.at(delay, _M.flush_capture, key, sidecar_url, dict, attempt + 1)
    if not ok then
      ngx.log(ngx.WARN, "faremeter: failed to schedule capture retry timer for key ", key, ": ", timer_err)
    end
  else
    ngx.log(ngx.ERR, "faremeter: capture permanently lost for key ", key, " after ", max_attempts, " attempts: ", msg)
  end
end

-- Cap on how many bytes we'll keep buffered between SSE chunks across a
-- single request. This is the streaming analogue of the body-filter.lua
-- 1 MiB non-SSE cap: without a limit, an upstream that emits a line
-- without a newline (or an event without a blank-line terminator) can
-- grow the worker's per-request Lua heap unbounded. 1 MiB is plenty
-- for typical SSE payloads; over-limit streams drop capture for the
-- request (settlement still happens against the authorized amount).
--
-- The cap is applied to two independent accumulators:
--   1. `#raw` — the per-chunk `(partial_line .. chunk)` snapshot,
--      bounding how much a single chunk can buffer from an upstream
--      that emits a line without a newline terminator.
--   2. `buffer.data_lines_bytes` — the cross-chunk accumulator of
--      `data:` line value bytes, bounding the total memory that a
--      stream of many valid `data:` lines can hold before an event
--      terminator arrives. The per-chunk cap does not cover this:
--      each chunk can stay well below 1 MiB while the accumulator
--      grows linearly in the number of `data:` lines observed.
local max_sse_buffer = 1048576

local function trip_overflow(buffer, reason)
  ngx.log(ngx.WARN, "faremeter: ", reason, " (> ", max_sse_buffer,
    " bytes), dropping capture for this request")
  buffer.overflow = true
  buffer.partial_line = ""
  buffer.data_lines = {}
  buffer.data_lines_bytes = 0
end

function _M.parse_sse_chunk(buffer, chunk)
  local events = {}

  if buffer.overflow then
    return events, buffer
  end

  local raw = (buffer.partial_line or "") .. chunk
  if #raw > max_sse_buffer then
    trip_overflow(buffer, "SSE raw chunk buffer exceeded cap")
    return events, buffer
  end

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
  buffer.data_lines_bytes = buffer.data_lines_bytes or 0

  for _, line in ipairs(lines) do
    if line == "" then
      if #buffer.data_lines > 0 then
        local data = table.concat(buffer.data_lines, "\n")
        events[#events + 1] = data
        buffer.data_lines = {}
        buffer.data_lines_bytes = 0
      end
    elseif line:sub(1, 1) == ":" then
      -- comment, skip
    elseif line:sub(1, 5) == "data:" then
      local value = line:sub(6)
      if value:sub(1, 1) == " " then
        value = value:sub(2)
      end
      buffer.data_lines[#buffer.data_lines + 1] = value
      buffer.data_lines_bytes = buffer.data_lines_bytes + #value
      if buffer.data_lines_bytes > max_sse_buffer then
        trip_overflow(buffer,
          "SSE data_lines accumulator exceeded cap without event terminator")
        return events, buffer
      end
    else
      -- event:, id:, retry:, or unknown fields: skip
    end
  end

  return events, buffer
end

-- Extract each JSONPath in `capture_paths` from `parsed` and merge
-- the non-nil values into `accumulated` (a flat map keyed by path).
-- Designed for multi-frame transports (WebSocket) where a single
-- capture body is built up across several parsed frames. Callers
-- invoke this once per frame and then call `reconstruct_nested` once
-- at delivery time.
--
-- A naive "rebuild flat on every frame then reassign captured =
-- reconstruct_nested(flat)" pattern would silently drop any fields
-- seen in earlier frames, because each reassignment replaces the
-- whole captured body rather than merging into it. Multi-frame
-- protocols that stream `prompt_tokens` in one message and
-- `completion_tokens` in a later one would only ever deliver the
-- last frame's fields.
--
-- Nil values from absent fields are skipped so that a later frame
-- missing a previously-seen field does not clobber the earlier
-- value.
function _M.accumulate_fields(accumulated, parsed, capture_paths)
  for _, path in ipairs(capture_paths) do
    local v = _M.extract_field(parsed, path)
    if v ~= nil then
      accumulated[path] = v
    end
  end
end

-- Detect a `text/event-stream` Content-Type, case-insensitively, from
-- either a string header value or a Lua table (which `ngx.header` and
-- `ngx.resp.get_headers` return when a header is set multiple times —
-- e.g. duplicate upstream Content-Type or a previous Lua phase setting
-- a table). Unguarded `ct:lower()` would throw
-- `attempt to call method 'lower' (a nil value)` on the table case and
-- abort the header_filter_by_lua phase.
--
-- RFC 9110 §8.3 requires media-type matching to be case-insensitive;
-- `Text/Event-Stream` and `text/EVENT-STREAM` both count.
function _M.is_sse_content_type(ct)
  if ct == nil then
    return false
  end
  if type(ct) == "table" then
    for _, v in ipairs(ct) do
      if _M.is_sse_content_type(v) then
        return true
      end
    end
    return false
  end
  if type(ct) ~= "string" then
    return false
  end
  return ct:lower():find("text/event-stream", 1, true) ~= nil
end

return _M
