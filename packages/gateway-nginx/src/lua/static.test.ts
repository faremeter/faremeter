#!/usr/bin/env pnpm tsx

import t from "tap";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const luaDir = dirname(fileURLToPath(import.meta.url));

function readLua(name: string): string {
  return readFileSync(resolve(luaDir, name), "utf-8");
}

await t.test(
  "access.lua nil-check loop does not use ipairs over payload_parts",
  (t) => {
    // payload_parts is constructed from cjson.safe.encode return values,
    // which can legitimately be nil on encode failure (NaN, cycles, huge
    // strings, etc.). ipairs() stops at the first nil per the Lua
    // reference manual, so the `if v == nil then return bad_gateway(...)`
    // body inside `for i, v in ipairs(payload_parts)` is unreachable.
    // When a nil slips through, table.concat(payload_parts) raises and
    // the access phase surfaces an nginx 500 instead of the intended
    // clean 502 bad_gateway.
    //
    // To iterate a sparse table safely, use numeric indexing with an
    // explicit upper bound, e.g. `for i = 1, N do local v = t[i] ...`.
    const src = readLua("access.lua");
    t.notMatch(
      src,
      /for\s+\w+\s*,\s*\w+\s+in\s+ipairs\s*\(\s*payload_parts\s*\)/,
      "payload_parts nil-check must not use ipairs",
    );
    t.end();
  },
);

await t.test("body-filter.lua caps non-SSE body accumulation", (t) => {
  // The non-SSE branch of body-filter.lua appends every upstream chunk
  // to ngx.ctx.fm_body_chunks until EOF. With no size cap, a
  // hundred-megabyte JSON response (benign or adversarial) allocates
  // that entire body in Lua heap per in-flight request. Multiply by
  // worker_processes × concurrent paid requests and that becomes a
  // post-payment DoS vector.
  //
  // The fix is to track a cumulative byte count and either drop the
  // capture or abort the request when the body exceeds a sensible
  // limit. Any of the conventional patterns — a numeric limit constant,
  // a cumulative byte counter, a size check against the current buffer
  // — satisfy this invariant.
  const src = readLua("body-filter.lua");
  const hasLimit =
    /max_body|body_limit|body_max|body_size|fm_body_bytes|#chunk/.test(src);
  t.ok(hasLimit, "body-filter.lua must bound response body accumulation");
  t.end();
});

await t.test(
  "header-filter.lua does not rely on ngx.var.proxy_buffering",
  (t) => {
    // proxy_buffering is consulted by nginx's upstream module when it
    // decides how to handle the upstream response. header_filter_by_lua
    // runs after upstream response headers have been received and the
    // buffering decision has already been made — setting
    // ngx.var.proxy_buffering at this point has no effect on buffering
    // for the current request. SSE responses would remain buffered
    // despite the intent.
    //
    // The correct place to disable buffering for a response is either
    // in the location block directly (via a literal
    // `proxy_buffering off;` behind a `map` on Content-Type) or in
    // access_by_lua before upstream connect.
    const src = readLua("header-filter.lua");
    t.notMatch(
      src,
      /ngx\.var\.proxy_buffering\s*=/,
      "header_filter_by_lua runs too late to affect proxy_buffering",
    );
    t.end();
  },
);

await t.test("shared.lua caps SSE partial-line and data-lines buffers", (t) => {
  // The SSE branch of body-filter.lua delegates to
  // fm.parse_sse_chunk, which appends to buffer.partial_line and
  // buffer.data_lines without any size limit. A stream that sends a
  // very long line without a newline, or many data: lines without a
  // terminating blank line, grows worker memory unbounded. This is
  // the direct SSE analogue of the body-filter.lua 1 MiB cap that
  // was added in the round 3.5 fixes — until this path is bounded
  // the DoS surface is only half-closed.
  const src = readLua("shared.lua");
  // The cap must be a named limit constant that the SSE parser
  // consults before growing the buffers. Any of the conventional
  // names satisfies the invariant; without one, the SSE streaming
  // path is unbounded.
  const hasLimit =
    /max_sse|sse_limit|sse_max|max_partial_line|partial_line_max|partial_line_limit|max_data_lines|data_lines_max|data_lines_limit|max_sse_buffer|sse_buffer_max|sse_buffer_limit/.test(
      src,
    );
  t.ok(
    hasLimit,
    "parse_sse_chunk must bound partial_line and data_lines growth",
  );
  t.end();
});

await t.test(
  "header-filter.lua matches Content-Type SSE case-insensitively",
  (t) => {
    // RFC 9110 §8.3: media types are case-insensitive.
    // `Text/Event-Stream` and `text/EVENT-STREAM` must be detected as
    // SSE. Lua string.find with a pattern is case-sensitive; the fix
    // is either to lowercase the header value before matching or to
    // use a case-insensitive character class. Otherwise upstreams that
    // emit non-lowercase Content-Type slip into the non-SSE branch and
    // hit the 1 MiB cap as a side effect.
    const src = readLua("header-filter.lua");
    // Acceptable patterns: lower-casing before compare, OR a character
    // class that matches both cases (e.g. [Tt][Ee][Xx][Tt]).
    const hasCaseInsensitive =
      /string\.lower|:lower\(\)|tolower|\[[Tt]\]\[[Ee]\]/.test(src);
    t.ok(
      hasCaseInsensitive,
      "Content-Type SSE detection must be case-insensitive per RFC 9110",
    );
    t.end();
  },
);

await t.test(
  "body-filter.lua / websocket.lua search-key probe is JSON-aware",
  (t) => {
    // body-filter.lua (and websocket.lua) prefilter the response body
    // by scanning for literal `"KEY"` byte sequences before decoding.
    // For keys containing characters that JSON would escape (`"`, `\`,
    // control chars), the encoded form in the response body has
    // escape sequences (`"a\"b"`), which the plain-substring probe
    // will never match. The capture is silently dropped even when the
    // field is present.
    //
    // Acceptable fixes include: route the key through a cjson-aware
    // serializer before comparing, require all search keys to be ASCII
    // identifier-safe, or fall back to the slow path (cjson.decode +
    // tree walk) whenever the probe produces no match AND the keys
    // contain JSON-escape-requiring bytes.
    const body = readLua("body-filter.lua");
    const ws = readLua("websocket.lua");
    const plainConcat = /'"'\s*\.\.\s*key\s*\.\.\s*'"'/;
    t.notMatch(
      body,
      plainConcat,
      "body-filter.lua must not concatenate raw keys between literal quotes",
    );
    t.notMatch(
      ws,
      plainConcat,
      "websocket.lua must not concatenate raw keys between literal quotes",
    );
    t.end();
  },
);

await t.test(
  "access.lua surfaces a file-open failure on the spooled body path",
  (t) => {
    // When the request body is spooled to a temp file instead of
    // held in memory, `io.open` can fail (permissions, disk error,
    // file already unlinked). A nil `fh` must surface as a
    // bad_gateway, not silently leave `raw_body` as "null" and let
    // the evaluator price against an empty body — that would be a
    // silent under-metering of requests whose body happens to spool.
    const src = readLua("access.lua");
    const opensBodyFile = /io\.open\s*\(\s*file/.test(src);
    t.ok(opensBodyFile, "sanity: access.lua opens the spooled body file");
    // Expect a bad_gateway (or equivalent explicit error) within a
    // few lines of the io.open site. The current code path has no
    // such check between the `if fh then` guard and the fall-through.
    const opensAndErrors =
      /io\.open\s*\([^)]+\)\s*\n\s*if\s+not\s+fh\s+then[^\n]*\n[^\n]*bad_gateway/;
    t.match(
      src,
      opensAndErrors,
      "io.open failure must surface as bad_gateway, not silently fall through",
    );
    t.end();
  },
);

await t.test(
  "body-filter.lua accumulates capture fields across SSE events",
  (t) => {
    // Each SSE event in a streaming response may carry a disjoint
    // subset of the capture fields. The naive "rebuild flat map,
    // reassign ngx.ctx.fm_captured" pattern wipes the earlier
    // event's fields on every subsequent event. The fix is the
    // same as the one applied to websocket.lua: accumulate into
    // a single long-lived flat table via `fm.accumulate_fields`
    // and reconstruct the nested view on every call so log-phase
    // readers always see the union of every event processed so
    // far. Re-assigning `fm_captured` from the accumulated flat
    // table is fine — the bug being guarded against is rebuilding
    // the flat table from scratch on each event.
    const src = readLua("body-filter.lua");
    t.match(
      src,
      /fm\.accumulate_fields/,
      "body-filter.lua must use fm.accumulate_fields for multi-event SSE capture",
    );
    t.match(
      src,
      /fm_captured_flat/,
      "body-filter.lua must persist a flat accumulator across calls",
    );
    t.end();
  },
);

await t.test(
  "body-filter.lua search-key probe accounts for cjson's `/` escaping",
  (t) => {
    // Search keys are pre-encoded by the generator via
    // JSON.stringify, which leaves `/` unescaped. cjson.encode on
    // the upstream side of a Lua/OpenResty proxy (or Perl
    // JSON::PP, or legacy PHP) produces `\/` instead. The
    // byte-for-byte probe `string.find(data, key, 1, true)`
    // therefore misses any key containing `/` when the upstream
    // body happens to be cjson-encoded, silently dropping capture.
    //
    // Fixes include: normalize `/` to the cjson form in the
    // generator, add a second probe with the escaped form, or
    // fall back to a tree-walk decode when the fast-path probe
    // misses. Any of those touches body-filter or its generator.
    const bodyFilterLua = readLua("body-filter.lua");
    const bodyFilterTs = readFileSync(
      resolve(luaDir, "body-filter.ts"),
      "utf-8",
    );
    const combined = bodyFilterLua + bodyFilterTs;
    const hasSlashHandling =
      combined.includes("\\/") || /cjson|tree.?walk|fallback/i.test(combined);
    t.ok(
      hasSlashHandling,
      "body-filter must account for cjson's `/` escaping in search-key matching",
    );
    t.end();
  },
);

await t.test(
  "log.lua and websocket.lua use fm_req_body_raw for digest-stable encoding",
  (t) => {
    const log = readLua("log.lua");
    const ws = readLua("websocket.lua");
    t.match(
      log,
      /fm_req_body_raw/,
      "log.lua must reference fm_req_body_raw for the request body field",
    );
    t.match(
      ws,
      /fm_req_body_raw/,
      "websocket.lua must reference fm_req_body_raw for the request body field",
    );
    t.end();
  },
);

await t.test(
  "access.lua surfaces a cjson.encode failure on the error response path",
  (t) => {
    // The non-200 error response path calls `cjson.encode(gateway.body)`
    // and currently gates the subsequent `ngx.say` on whether the
    // encode returned non-nil — but silently skips the body when it
    // did return nil. A nil encode leaves the client with a bare
    // status code and no error body, and leaves no log entry.
    // Expect at least an ngx.log(ngx.ERR, ...) on the nil-encode
    // branch, or an explicit bad_gateway return.
    const src = readLua("access.lua");
    // Find the cjson.encode(gateway.body) site and verify the branch
    // where the encode returned nil does more than just skip the say.
    const encodeAndLog =
      /cjson\.encode\s*\(\s*gateway\.body\s*\)[\s\S]{0,400}?(ngx\.log\s*\(\s*ngx\.ERR|bad_gateway)/;
    t.match(
      src,
      encodeAndLog,
      "cjson.encode failure on the gateway.body path must log or bail out, not silently skip",
    );
    t.end();
  },
);
