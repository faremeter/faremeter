#!/usr/bin/env pnpm tsx

import t from "tap";
import { luaEscape } from "./common.js";

await t.test("passes a basic string through unchanged", async (t) => {
  t.equal(luaEscape("hello world"), "hello world");
  t.end();
});

await t.test("escapes backslashes", async (t) => {
  t.equal(luaEscape("a\\b"), "a\\\\b");
  t.end();
});

await t.test("escapes double quotes", async (t) => {
  t.equal(luaEscape('say "hi"'), 'say \\"hi\\"');
  t.end();
});

await t.test("escapes newlines", async (t) => {
  t.equal(luaEscape("line1\nline2"), "line1\\nline2");
  t.end();
});

await t.test("escapes carriage returns", async (t) => {
  t.equal(luaEscape("line1\rline2"), "line1\\rline2");
  t.end();
});

await t.test("escapes null bytes", async (t) => {
  t.equal(luaEscape("before\0after"), "before\\0after");
  t.end();
});

await t.test("escapes tabs", async (t) => {
  t.equal(luaEscape("col1\tcol2"), "col1\\tcol2");
  t.end();
});

await t.test("escapes multiple special characters in one string", async (t) => {
  const input = 'path\\to\n"file"\r\0\tend';
  const expected = 'path\\\\to\\n\\"file\\"\\r\\0\\tend';
  t.equal(luaEscape(input), expected);
  t.end();
});

await t.test("result is valid inside a Lua double-quoted string", async (t) => {
  const nasty = 'he said "hello\\world"\n\r\0\t';
  const escaped = luaEscape(nasty);

  t.equal(escaped.includes("\n"), false, "no literal newline");
  t.equal(escaped.includes("\r"), false, "no literal carriage return");
  t.equal(escaped.includes("\0"), false, "no literal null byte");
  t.equal(escaped.includes("\t"), false, "no literal tab");
  t.notMatch(escaped, /(?<!\\)"/g, "no unescaped double quotes");
  t.end();
});
