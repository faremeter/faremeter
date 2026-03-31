local fm = require("faremeter")
local cjson = require("cjson")

local dict = ngx.shared.fm_capture_buffer
local uri = ngx.var.uri

if uri == "/write-and-read" then
  dict:flush_all()
  fm.write_capture(dict, "req1:POST /v1/chat", '{"tokens":42}', 60)
  local stored = dict:get("req1:POST /v1/chat")
  ngx.say(cjson.encode({ stored = stored }))

elseif uri == "/concurrent-keys" then
  dict:flush_all()
  fm.write_capture(dict, "reqA:POST /v1/chat", '{"request":"first"}', 60)
  fm.write_capture(dict, "reqB:POST /v1/chat", '{"request":"second"}', 60)
  local val_a = dict:get("reqA:POST /v1/chat")
  local val_b = dict:get("reqB:POST /v1/chat")
  ngx.say(cjson.encode({ a = val_a, b = val_b }))

elseif uri == "/overwrite" then
  dict:flush_all()
  fm.write_capture(dict, "req3:POST /v1/chat", '{"attempt":1}', 60)
  fm.write_capture(dict, "req3:POST /v1/chat", '{"attempt":2}', 60)
  local stored = dict:get("req3:POST /v1/chat")
  ngx.say(cjson.encode({ stored = stored }))

elseif uri == "/flush-premature" then
  dict:flush_all()
  fm.write_capture(dict, "req4:POST /v1/chat", '{"data":"keep"}', 60)
  fm.flush_capture(true, "req4:POST /v1/chat", "http://127.0.0.1:19999", dict)
  local stored = dict:get("req4:POST /v1/chat")
  ngx.say(cjson.encode({ stored = stored }))

elseif uri == "/flush-missing" then
  dict:flush_all()
  fm.flush_capture(false, "nonexistent:key", "http://127.0.0.1:19999", dict)
  local stored = dict:get("nonexistent:key")
  ngx.say(cjson.encode({ stored = stored == nil and cjson.null or stored }))

elseif uri == "/extract-dot-path" then
  local obj = { usage = { prompt_tokens = 12, completion_tokens = 34 } }
  ngx.say(cjson.encode({
    prompt = fm.extract_field(obj, "usage.prompt_tokens"),
    completion = fm.extract_field(obj, "usage.completion_tokens"),
    missing = fm.extract_field(obj, "usage.missing") or cjson.null,
  }))

elseif uri == "/extract-bracket-path" then
  -- ['some.key'] bracket notation with embedded dots
  local obj = { ["weird.key"] = { value = 42 } }
  ngx.say(cjson.encode({
    value = fm.extract_field(obj, "['weird.key'].value"),
  }))

elseif uri == "/extract-numeric-index" then
  local obj = { items = { "alpha", "beta", "gamma" } }
  ngx.say(cjson.encode({
    first = fm.extract_field(obj, "items[0]"),
    third = fm.extract_field(obj, "items[2]"),
    nested = fm.extract_field(obj, "items[1]") or cjson.null,
  }))

elseif uri == "/extract-unparseable" then
  -- Non-numeric unquoted bracket must not crash; returns nil + logs.
  ngx.say(cjson.encode({
    result = fm.extract_field({}, "items[abc]") or cjson.null,
  }))

elseif uri == "/reconstruct-nested" then
  local flat = {
    ["usage.prompt_tokens"] = 12,
    ["usage.completion_tokens"] = 34,
    ["model"] = "gpt-4o",
  }
  local nested = fm.reconstruct_nested(flat)
  ngx.say(cjson.encode(nested))

elseif uri == "/parse-sse-split" then
  -- Feed the parser in two chunks to verify partial-line buffering.
  local buffer = { partial_line = "", data_lines = {} }
  local events1 = fm.parse_sse_chunk(buffer, "data: hello")
  local events2 = fm.parse_sse_chunk(buffer, " world\n\ndata: next\n\n")
  ngx.say(cjson.encode({
    first_batch = events1,
    second_batch = events2,
  }))

elseif uri == "/parse-sse-comments" then
  local buffer = { partial_line = "", data_lines = {} }
  local events = fm.parse_sse_chunk(
    buffer,
    ": heartbeat\ndata: payload\n\nevent: foo\ndata: second\n\n"
  )
  ngx.say(cjson.encode({ events = events }))

elseif uri == "/parse-sse-crlf" then
  local buffer = { partial_line = "", data_lines = {} }
  local events = fm.parse_sse_chunk(buffer, "data: first\r\n\r\ndata: second\r\n\r\n")
  ngx.say(cjson.encode({ events = events }))

elseif uri == "/ws-multi-frame-accumulate" then
  -- WebSocket capture must accumulate fields across frames. Naively
  -- rebuilding a flat map on every matching frame and reassigning
  -- `captured = fm.reconstruct_nested(flat)` loses all but the last
  -- frame's fields — a multi-frame chat protocol that streams
  -- `prompt_tokens` in one message and `completion_tokens` in a later
  -- one would only deliver the last one.
  --
  -- The correct pattern is to accumulate a single flat map across
  -- frames via `fm.accumulate_fields` and then reconstruct once at
  -- delivery time. This endpoint simulates two frames and verifies
  -- the union is delivered.
  local capture_paths = { "usage.prompt_tokens", "usage.completion_tokens" }

  local frame1 = { usage = { prompt_tokens = 10 } }
  local frame2 = { usage = { completion_tokens = 20 } }

  local accumulated = {}
  fm.accumulate_fields(accumulated, frame1, capture_paths)
  fm.accumulate_fields(accumulated, frame2, capture_paths)

  local body = fm.reconstruct_nested(accumulated)
  ngx.say(cjson.encode({
    prompt_tokens = body.usage and body.usage.prompt_tokens,
    completion_tokens = body.usage and body.usage.completion_tokens,
  }))

elseif uri == "/is-sse-content-type" then
  -- Content-Type detection must accept both string and table forms.
  -- `ngx.header["Content-Type"]` returns a Lua table when the response
  -- carries multiple Content-Type headers (misconfigured upstream or
  -- a previous Lua phase setting a table). An unguarded `ct:lower()`
  -- throws `attempt to call method 'lower' (a nil value)` because
  -- tables have no string metamethods — aborting the filter phase and
  -- taking the request with it.
  ngx.say(cjson.encode({
    plain = fm.is_sse_content_type("text/event-stream"),
    uppercase = fm.is_sse_content_type("TEXT/EVENT-STREAM"),
    mixed = fm.is_sse_content_type("Text/Event-Stream; charset=utf-8"),
    empty = fm.is_sse_content_type(""),
    nil_val = fm.is_sse_content_type(nil),
    html = fm.is_sse_content_type("text/html"),
    table_with_sse = fm.is_sse_content_type({ "text/html", "text/event-stream" }),
    table_without_sse = fm.is_sse_content_type({ "text/html", "application/json" }),
    table_empty = fm.is_sse_content_type({}),
  }))

elseif uri == "/parse-sse-data-lines-overflow" then
  -- Feed many `data:` lines in chunks with no blank-line terminator.
  -- Each individual chunk stays well below `max_sse_buffer`, so the
  -- per-chunk `#raw` cap never trips — but the `data_lines`
  -- accumulator grows every iteration because it is only cleared on
  -- an event terminator. Without a second cap on data_lines bytes,
  -- the accumulator grows without bound and a hostile or buggy
  -- upstream can OOM a worker inside a single long-lived request.
  local buffer = { partial_line = "", data_lines = {} }
  local value = string.rep("y", 1024)
  local line = "data: " .. value .. "\n"
  local chunk = string.rep(line, 100)
  -- Each chunk is ~103 KB of raw wire bytes and ~100 KB of value
  -- bytes inside data_lines. 11 chunks accumulate ~1.1 MB of value
  -- bytes, pushing data_lines past the 1 MiB cap.
  for _ = 1, 11 do
    fm.parse_sse_chunk(buffer, chunk)
    if buffer.overflow then break end
  end
  ngx.say(cjson.encode({
    overflow = buffer.overflow == true,
    data_lines_count = #buffer.data_lines,
  }))

else
  ngx.status = 404
  ngx.say("unknown test endpoint")
end
