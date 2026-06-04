#!/usr/bin/env pnpm tsx

import t from "tap";

import { formatMPPDateTime, parseMPPExpiresAtMs } from "./encoding";

await t.test("formatMPPDateTime emits second-precision RFC3339", (t) => {
  t.equal(
    formatMPPDateTime(new Date("2026-06-01T12:34:56.789Z")),
    "2026-06-01T12:34:56Z",
  );
  t.end();
});

await t.test("parseMPPExpiresAtMs accepts RFC3339 timestamps", (t) => {
  const expected = Date.UTC(2026, 5, 1, 12, 34, 56);

  t.equal(parseMPPExpiresAtMs("2026-06-01T12:34:56Z"), expected);
  t.equal(parseMPPExpiresAtMs("2026-06-01T12:34:56.789Z"), expected + 789);
  t.equal(parseMPPExpiresAtMs("2026-06-01T14:34:56+02:00"), expected);
  t.end();
});

await t.test("parseMPPExpiresAtMs accepts legacy unix seconds", (t) => {
  t.equal(parseMPPExpiresAtMs("4102444800"), 4_102_444_800_000);
  t.end();
});

await t.test("parseMPPExpiresAtMs rejects malformed timestamps", (t) => {
  for (const expires of [
    "",
    "not-a-date",
    "2026-06-01",
    "-1",
    "999999999999999999999999999999",
  ]) {
    t.equal(parseMPPExpiresAtMs(expires), null, expires);
  }
  t.end();
});
