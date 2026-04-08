#!/usr/bin/env pnpm tsx

import t from "tap";
import { mppReceipt } from "./types";
import { serializeReceipt, parseReceipt } from "./encoding";
import { isValidationError } from "../validation";

await t.test("mppReceipt round-trips without extras", async (t) => {
  const receipt: mppReceipt = {
    status: "success",
    method: "solana",
    intent: "charge",
    timestamp: "2024-01-01T00:00:00.000Z",
    reference: "tx-abc",
  };
  const parsed = parseReceipt(serializeReceipt(receipt));
  t.matchOnly(parsed, receipt);
  t.end();
});

await t.test("mppReceipt round-trips with extras", async (t) => {
  const receipt: mppReceipt = {
    status: "success",
    method: "solana",
    intent: "session",
    timestamp: "2024-01-01T00:00:00.000Z",
    reference: "tx-abc",
    extra: {
      channelId: "escrow-pda",
      acceptedCumulative: "100",
      spent: "40",
    },
  };
  const parsed = parseReceipt(serializeReceipt(receipt));
  t.matchOnly(parsed, receipt);
  t.end();
});

await t.test("mppReceipt rejects a receipt without intent", async (t) => {
  const receipt = {
    status: "success",
    method: "solana",
    timestamp: "2024-01-01T00:00:00.000Z",
    reference: "tx-abc",
  };
  const validated = mppReceipt(receipt);
  t.ok(
    isValidationError(validated),
    "intent is REQUIRED per draft-solana-session-00 §Receipt Format",
  );
  t.end();
});

await t.test("mppReceipt rejects unknown top-level keys", async (t) => {
  const receipt = {
    status: "success",
    method: "solana",
    timestamp: "2024-01-01T00:00:00.000Z",
    reference: "tx-abc",
    channelId: "escrow-pda",
  };
  const validated = mppReceipt(receipt);
  t.ok(isValidationError(validated), "top-level extras must live under extra");
  t.end();
});

await t.test(
  "parseReceipt returns undefined for unknown top-level keys",
  (t) => {
    const junk = btoa(
      JSON.stringify({
        status: "success",
        method: "solana",
        timestamp: "2024-01-01T00:00:00.000Z",
        reference: "tx-abc",
        stray: "value",
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    t.equal(parseReceipt(junk), undefined);
    t.end();
  },
);
