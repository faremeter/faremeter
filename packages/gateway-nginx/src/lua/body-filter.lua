-- preamble: capture_fields, search_keys

local cjson = require("cjson")
local fm = require("faremeter")

if not ngx.ctx.fm_paid then
  return
end

local function extract_fields(parsed)
  local flat = {}
  for _, path in ipairs(capture_fields) do
    flat[path] = fm.extract_field(parsed, path)
  end
  ngx.ctx.fm_captured = fm.reconstruct_nested(flat)
end

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
else
  if not ngx.ctx.fm_body_chunks then
    ngx.ctx.fm_body_chunks = {}
  end
  table.insert(ngx.ctx.fm_body_chunks, chunk)

  if eof then
    local full = table.concat(ngx.ctx.fm_body_chunks)
    ngx.ctx.fm_body_chunks = nil
    local ok, parsed = pcall(cjson.decode, full)
    if ok then
      extract_fields(parsed)
    end
  end
end
