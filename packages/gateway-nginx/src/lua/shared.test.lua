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
  ngx.say(cjson.encode({ stored = cjson.null }))

else
  ngx.status = 404
  ngx.say("unknown test endpoint")
end
