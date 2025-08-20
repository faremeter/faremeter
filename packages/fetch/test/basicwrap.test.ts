#!/usr/bin/env pnpm tsx

import t from "tap";
import * as fmFetch from "../src/index";
import * as fmTypes from "../src/types";

import { responseFeeder } from "./mockfetch";

t.test("basicWrap", async (t) => {
  const expectedAccepts = [
    {
      scheme: "exact",
      network: "solana-mainnet",
      maxAmountRequired: "1.0",
      resource: "http://wherever",
      description: "what is a description",
      mimeType: "text/plain",
      payTo: "someaccount",
      maxTimeoutSeconds: 5,
      asset: "theasset",
    },
  ];

  const fakeHandler: fmTypes.PaymentHandler = async (ctx, required) => {
    t.equal(required.length, 1);
    t.matchOnly(required, expectedAccepts);

    const execers: fmTypes.PaymentExecer[] = [
      {
        requirements: required[0],
        exec: async () => ({
          headers: { "X-PAYMENT": "heresmypayment" },
        }),
      },
    ];

    return execers;
  };

  const mockFetch = responseFeeder([
    async () => {
      return new Response(
        JSON.stringify({
          x402Version: 1,
          accepts: expectedAccepts,
        }),
        {
          status: 402,
        },
      );
    },
    async (input, init?: RequestInit) => {
      if (init?.headers === undefined) {
        throw new Error("didn't get back request headers");
      }

      const headers = init.headers;

      t.match(headers["X-PAYMENT"], "heresmypayment");

      return new Response("mypayload");
    },
  ]);

  const wrappedFetch = fmFetch.wrap(mockFetch, {
    handlers: [fakeHandler],
  });

  const res = await wrappedFetch("http://somewhere/something/protected");

  const body = await res.text();
  t.match(body, "mypayload");

  t.pass();
  t.end();
});
