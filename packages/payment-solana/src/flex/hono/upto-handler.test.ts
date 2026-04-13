#!/usr/bin/env pnpm tsx

import t from "tap";
import { Hono } from "hono";
import { createUptoHandler } from "./upto-handler";

const SCHEME = "upto";
const NETWORK = "solana:devnet";
const ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAY_TO = "J8tVV2K1Lf9P3E7vXqFm4TnUz4DqvJAA8bFkaiAAaaaa";

const REQUIREMENTS = {
  scheme: SCHEME,
  network: NETWORK,
  amount: "10000",
  asset: ASSET,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
};

const PAYMENT_PAYLOAD = {
  x402Version: 2,
  accepted: REQUIREMENTS,
  payload: { escrow: "test", signature: "test" },
};

function encodePaymentHeader(payload: unknown): string {
  return btoa(JSON.stringify(payload));
}

type FacilitatorCall = {
  url: string;
  body: {
    paymentRequirements: { amount: string };
    [key: string]: unknown;
  };
};

function createMockFetch(overrides?: {
  acceptsResponse?: unknown;
  verifyResponse?: unknown;
  settleResponse?: unknown;
}) {
  const calls: FacilitatorCall[] = [];

  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : new URL(input.url).toString();
    const body = init?.body
      ? (JSON.parse(init.body as string) as FacilitatorCall["body"])
      : ({ paymentRequirements: { amount: "" } } as FacilitatorCall["body"]);
    calls.push({ url, body });

    if (url.endsWith("/accepts")) {
      return Response.json(
        overrides?.acceptsResponse ?? {
          x402Version: 2,
          resource: { url: "http://localhost/test" },
          accepts: [REQUIREMENTS],
        },
      );
    }

    if (url.endsWith("/verify")) {
      return Response.json(
        overrides?.verifyResponse ?? {
          isValid: true,
          payer: "payer123",
        },
      );
    }

    if (url.endsWith("/settle")) {
      return Response.json(
        overrides?.settleResponse ?? {
          success: true,
          transaction: "tx123",
          network: NETWORK,
          payer: "payer123",
        },
      );
    }

    return new Response("Not found", { status: 404 });
  };

  return { fetch: mockFetch as typeof fetch, calls };
}

function createTestApp(
  opts?: Partial<Parameters<typeof createUptoHandler>[0]>,
) {
  const mock = createMockFetch(opts as { settleResponse?: unknown });
  const authorize = opts?.authorize ?? ((_body: unknown) => 10000n);
  const handle =
    opts?.handle ??
    (async (_body: unknown, settle) => {
      const settlement = await settle(5000n);
      return Response.json({ result: "ok", payment: settlement });
    });

  const app = new Hono();
  app.post(
    "/test",
    createUptoHandler({
      facilitatorURL: "http://facilitator",
      accepts: [
        {
          scheme: SCHEME,
          network: NETWORK,
          amount: "10000",
          asset: ASSET,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
      ],
      authorize,
      handle,
      fetch: mock.fetch,
      ...opts,
    }),
  );

  return { app, mock };
}

function findCall(calls: FacilitatorCall[], endpoint: string): FacilitatorCall {
  const call = calls.find((c) => c.url.endsWith(endpoint));
  if (!call) throw new Error(`No call to ${endpoint} found`);
  return call;
}

await t.test("createUptoHandler", async (t) => {
  await t.test("returns 402 when no payment header is present", async (t) => {
    const { app } = createTestApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ max_tokens: 100 }),
    });

    t.equal(res.status, 402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    if (!header) throw new Error("Missing PAYMENT-REQUIRED header");

    const decoded = JSON.parse(atob(header)) as {
      accepts: { scheme: string }[];
    };
    t.equal(decoded.accepts.length, 1);
    t.equal(decoded.accepts[0]?.scheme, SCHEME);
  });

  await t.test(
    "verifies, authorizes, and settles a valid payment",
    async (t) => {
      const { app, mock } = createTestApp();

      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
        },
        body: JSON.stringify({ max_tokens: 100 }),
      });

      t.equal(res.status, 200);
      const body = (await res.json()) as {
        result: string;
        payment: { success: boolean; transaction: string };
      };
      t.equal(body.result, "ok");
      t.equal(body.payment.success, true);
      t.equal(body.payment.transaction, "tx123");

      findCall(mock.calls, "/verify");
      const settleCall = findCall(mock.calls, "/settle");
      t.equal(settleCall.body.paymentRequirements.amount, "5000");
    },
  );

  await t.test("passes parsed body to authorize callback", async (t) => {
    let receivedBody: unknown;
    const { app } = createTestApp({
      authorize: (body) => {
        receivedBody = body;
        return 10000n;
      },
    });

    await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({ max_tokens: 42 }),
    });

    t.strictSame(receivedBody, { max_tokens: 42 });
  });

  await t.test("passes parsed body to handle callback", async (t) => {
    let receivedBody: unknown;
    const { app } = createTestApp({
      handle: async (body, settle) => {
        receivedBody = body;
        await settle(100n);
        return Response.json({ ok: true });
      },
    });

    await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({ prompt: "hello" }),
    });

    t.strictSame(receivedBody, { prompt: "hello" });
  });

  await t.test("throws when settle amount exceeds ceiling", async (t) => {
    const { app } = createTestApp({
      authorize: () => 100n,
      handle: async (_body, settle) => {
        await settle(200n);
        return Response.json({ ok: true });
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 500);
  });

  await t.test(
    "mutates requirements.amount before calling facilitator settle",
    async (t) => {
      const { app, mock } = createTestApp({
        authorize: () => 10000n,
        handle: async (_body, settle) => {
          await settle(7777n);
          return Response.json({ ok: true });
        },
      });

      await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
        },
        body: JSON.stringify({}),
      });

      const settleCall = findCall(mock.calls, "/settle");
      t.equal(settleCall.body.paymentRequirements.amount, "7777");
    },
  );

  await t.test("returns 402 when verification fails", async (t) => {
    const mock = createMockFetch({
      verifyResponse: { isValid: false, invalidReason: "bad signature" },
    });

    const app = new Hono();
    app.post(
      "/test",
      createUptoHandler({
        facilitatorURL: "http://facilitator",
        accepts: [
          {
            scheme: SCHEME,
            network: NETWORK,
            amount: "10000",
            asset: ASSET,
            payTo: PAY_TO,
          },
        ],
        authorize: () => 10000n,
        handle: async (_body, settle) => {
          await settle(100n);
          return Response.json({ ok: true });
        },
        fetch: mock.fetch,
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 402);
  });

  await t.test("throws when facilitator settlement fails", async (t) => {
    const mock = createMockFetch({
      settleResponse: {
        success: false,
        transaction: "",
        network: NETWORK,
        errorReason: "insufficient funds",
      },
    });

    const app = new Hono();
    app.post(
      "/test",
      createUptoHandler({
        facilitatorURL: "http://facilitator",
        accepts: [
          {
            scheme: SCHEME,
            network: NETWORK,
            amount: "10000",
            asset: ASSET,
            payTo: PAY_TO,
          },
        ],
        authorize: () => 10000n,
        handle: async (_body, settle) => {
          await settle(100n);
          return Response.json({ ok: true });
        },
        fetch: mock.fetch,
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 500);
  });

  await t.test("supports async authorize callback", async (t) => {
    const { app } = createTestApp({
      authorize: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 10000n;
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 200);
  });

  await t.test("settle can be called with zero amount", async (t) => {
    const { app, mock } = createTestApp({
      authorize: () => 10000n,
      handle: async (_body, settle) => {
        await settle(0n);
        return Response.json({ ok: true });
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 200);
    const settleCall = findCall(mock.calls, "/settle");
    t.equal(settleCall.body.paymentRequirements.amount, "0");
  });

  await t.test("settle at exactly the ceiling amount succeeds", async (t) => {
    const { app } = createTestApp({
      authorize: () => 5000n,
      handle: async (_body, settle) => {
        await settle(5000n);
        return Response.json({ ok: true });
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 200);
  });

  await t.test("throws when settle is called twice", async (t) => {
    const { app } = createTestApp({
      authorize: () => 10000n,
      handle: async (_body, settle) => {
        await settle(1000n);
        await settle(2000n);
        return Response.json({ ok: true });
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 500);
  });

  await t.test("handler returns streaming response", async (t) => {
    const { app } = createTestApp({
      handle: async (_body, settle) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode("data: chunk1\n\n"));
            const settlement = await settle(100n);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(settlement)}\n\n`),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": encodePaymentHeader(PAYMENT_PAYLOAD),
      },
      body: JSON.stringify({}),
    });

    t.equal(res.status, 200);
    t.equal(res.headers.get("content-type"), "text/event-stream");
    const text = await res.text();
    t.ok(text.includes("chunk1"));
    t.ok(text.includes("tx123"));
  });
});
