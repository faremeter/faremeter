#!/usr/bin/env pnpm tsx

import t from "tap";
import { findMatchingPaymentRequirements } from "./common";

await t.test("findMatchingPaymentRequirements", async (t) => {
  await t.test(
    "matches v1 payload with CAIP-2 network against legacy network",
    async (t) => {
      const accepts = [
        {
          scheme: "exact",
          network: "eip155:84532",
          maxAmountRequired: "10000",
          resource: "http://localhost:3000/protected",
          description: "",
          mimeType: "",
          payTo: "0xrecipient",
          maxTimeoutSeconds: 60,
          asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        },
      ];

      const payload = {
        x402Version: 1 as const,
        scheme: "exact",
        network: "base-sepolia",
        asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        payload: { signature: "0xabc" },
      };

      const result = findMatchingPaymentRequirements(accepts, payload);
      t.ok(result, "should match despite network format difference");
      t.equal(result?.network, "eip155:84532");
      t.end();
    },
  );

  await t.test(
    "matches v1 payload when networks are already the same format",
    async (t) => {
      const accepts = [
        {
          scheme: "exact",
          network: "eip155:84532",
          maxAmountRequired: "10000",
          resource: "http://localhost/protected",
          description: "",
          mimeType: "",
          payTo: "0xrecipient",
          maxTimeoutSeconds: 60,
          asset: "0xtoken",
        },
      ];

      const payload = {
        x402Version: 1 as const,
        scheme: "exact",
        network: "eip155:84532",
        asset: "0xtoken",
        payload: { signature: "0xabc" },
      };

      const result = findMatchingPaymentRequirements(accepts, payload);
      t.ok(result, "should match when networks are identical");
      t.end();
    },
  );

  await t.test("returns undefined when no match", async (t) => {
    const accepts = [
      {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "10000",
        resource: "http://localhost/protected",
        description: "",
        mimeType: "",
        payTo: "0xrecipient",
        maxTimeoutSeconds: 60,
        asset: "0xtoken",
      },
    ];

    const payload = {
      x402Version: 1 as const,
      scheme: "exact",
      network: "eip155:1",
      asset: "0xtoken",
      payload: { signature: "0xabc" },
    };

    const result = findMatchingPaymentRequirements(accepts, payload);
    t.equal(result, undefined, "should not match different networks");
    t.end();
  });

  t.end();
});
