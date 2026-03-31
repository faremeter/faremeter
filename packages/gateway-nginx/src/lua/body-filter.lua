-- preamble: capture_fields, search_keys

local cjson = require("cjson")
local fm = require("faremeter")

if not ngx.ctx.fm_paid then
  return
end

-- Accumulate flat capture values across multiple parse events
-- (one call per SSE event, or a single call for a buffered JSON
-- body) and reconstruct the nested body on every call so that
-- log-phase code reading `ngx.ctx.fm_captured` always sees the
-- union of everything observed so far. See `fm.accumulate_fields`
-- in `shared.lua` for the multi-event rationale.
local function extract_fields(parsed)
  if not ngx.ctx.fm_captured_flat then
    ngx.ctx.fm_captured_flat = {}
  end
  fm.accumulate_fields(ngx.ctx.fm_captured_flat, parsed, capture_fields)
  ngx.ctx.fm_captured = fm.reconstruct_nested(ngx.ctx.fm_captured_flat)
end

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

-- Cap on how many bytes of upstream response body we'll accumulate for
-- capture. Without a cap, a large JSON response would allocate that
-- whole body in Lua heap per in-flight request and grow worker memory
-- unbounded. 1 MiB is plenty for typical pricing/usage fields; larger
-- bodies drop capture for the request (the payment still settles
-- against the authorized amount, so the client is still charged).
local max_body_bytes = 1048576

local chunk = ngx.arg[1]
local eof = ngx.arg[2]

if ngx.ctx.fm_is_sse then
  if not ngx.ctx.fm_line_buffer then
    ngx.ctx.fm_line_buffer = { partial_line = "" }
  end

  local events, remaining = fm.parse_sse_chunk(ngx.ctx.fm_line_buffer, chunk)
  ngx.ctx.fm_line_buffer = remaining

  for _, data in ipairs(events) do
    if matches_search_keys(data) then
      local ok, parsed = pcall(cjson.decode, data)
      if ok then
        extract_fields(parsed)
      end
    end
  end
elseif ngx.ctx.fm_body_overflow then
  -- Already abandoned capture on this request — drop further chunks.
  return
else
  if not ngx.ctx.fm_body_chunks then
    ngx.ctx.fm_body_chunks = {}
    ngx.ctx.fm_body_bytes = 0
  end
  ngx.ctx.fm_body_bytes = ngx.ctx.fm_body_bytes + #chunk
  if ngx.ctx.fm_body_bytes > max_body_bytes then
    ngx.log(ngx.WARN, "faremeter: response body exceeded ",
      max_body_bytes, " bytes, dropping capture for this request")
    ngx.ctx.fm_body_chunks = nil
    ngx.ctx.fm_body_bytes = nil
    ngx.ctx.fm_body_overflow = true
    return
  end
  table.insert(ngx.ctx.fm_body_chunks, chunk)

  if eof then
    local full = table.concat(ngx.ctx.fm_body_chunks)
    ngx.ctx.fm_body_chunks = nil
    ngx.ctx.fm_body_bytes = nil
    local ok, parsed = pcall(cjson.decode, full)
    if ok then
      extract_fields(parsed)
    end
  end
end
