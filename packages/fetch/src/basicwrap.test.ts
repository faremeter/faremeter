#!/usr/bin/env pnpm tsx

import t from "tap";
import * as fmFetch from "./index";
import * as fmTypes from "@faremeter/types/client";
import * as x402 from "@faremeter/types/x402";

import { responseFeeder } from "./mockfetch";

await t.test("basicWrap", async (t) => {
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

    const requirements = required[0];

    if (requirements === undefined) {
      throw new Error("expected to get at least 1 requirement");
    }

    const execers: fmTypes.PaymentExecer[] = [
      {
        requirements,
        exec: async () => ({
          payload: { key: "data" },
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

      const headers = new Headers(init.headers);
      const paymentPayload = x402.x402PaymentHeaderToPayload.assert(
        headers.get("X-PAYMENT"),
      );

      t.match(paymentPayload.payload, { key: "data" });

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

await t.test("failedPhase1", async (t) => {
  const phase1Fetch = responseFeeder([
    async () => {
      return new Response("the service is on fire", {
        status: 503,
      });
    },
    async () => {
      return new Response("it's all good", {
        status: 200,
      });
    },
  ]);

  const phase2fetch = responseFeeder([
    async () => {
      return new Response("you should never see this", {
        status: 500,
      });
    },
  ]);

  const wrappedFetch = fmFetch.wrap(phase2fetch, {
    phase1Fetch,
    handlers: [],
  });

  {
    const res = await wrappedFetch("http://somewhere/something/protected");

    t.equal(res.status, 503);
    const body = await res.text();
    t.matchOnly(body, "the service is on fire");
  }

  {
    const res = await wrappedFetch("http://somewhere/something/protected");

    const body = await res.text();
    t.equal(res.status, 200);
    t.matchOnly(body, "it's all good");
  }

  t.pass();
  t.end();
});
