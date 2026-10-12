#!/usr/bin/env pnpm tsx

import t from "tap";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";
import type { PaymentHandler } from "@faremeter/types/client";
import {
  computeBodyDigest,
  formatWWWAuthenticate,
  type MPPPaymentHandler,
} from "@faremeter/types/mpp";

import { wrap, type WrapOpts } from "./fetch";

const url = "https://example.com/protected";
const body = "original body";
const protocols = ["x402v1", "x402v2", "mpp"] as const;
type Protocol = (typeof protocols)[number];

function createPaymentOptions(protocol: Protocol): WrapOpts {
  const handler: PaymentHandler = async (_ctx, requirements) =>
    requirements.map((requirement) => ({
      requirements: requirement,
      exec: async () => ({ payload: { test: true } }),
    }));
  const mppHandler: MPPPaymentHandler = async (challenge) => ({
    challenge,
    exec: async () => ({ challenge, payload: { test: true } }),
  });
  return {
    handlers: [handler],
    ...(protocol === "mpp" ? { mppHandlers: [mppHandler] } : {}),
    retryCount: 1,
    initialRetryDelay: 0,
  };
}

function createPaymentResponse(protocol: Protocol, digest?: string) {
  if (protocol === "mpp") {
    return new Response(null, {
      status: 402,
      headers: {
        "WWW-Authenticate": formatWWWAuthenticate([
          {
            id: "test-id",
            realm: "test",
            method: "test-method",
            intent: "charge",
            request: "dGVzdA",
            ...(digest === undefined ? {} : { digest }),
          },
        ]),
      },
    });
  }

  const requirements = {
    scheme: "exact",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    amount: "1000",
    asset: "test-asset",
    payTo: "test-receiver",
    maxTimeoutSeconds: 60,
  };
  if (protocol === "x402v2") {
    return new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": btoa(
          JSON.stringify({
            x402Version: 2,
            resource: { url },
            accepts: [requirements],
          }),
        ),
      },
    });
  }

  return new Response(
    JSON.stringify({
      x402Version: 1,
      accepts: [
        {
          ...requirements,
          network: "solana-devnet",
          maxAmountRequired: requirements.amount,
          resource: url,
          description: "test resource",
          mimeType: "text/plain",
        },
      ],
    }),
    { status: 402 },
  );
}

for (const protocol of protocols) {
  const paymentHeader =
    protocol === "mpp"
      ? "Authorization"
      : protocol === "x402v2"
        ? "PAYMENT-SIGNATURE"
        : "X-PAYMENT";

  await t.test(
    `${protocol} preserves Request headers on paid retry`,
    async (t) => {
      let calls = 0;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        t.equal(request.headers.get("X-Caller"), "keep-me");
        t.equal(request.headers.has(paymentHeader), calls > 0);
        calls++;
        return calls === 1
          ? createPaymentResponse(protocol)
          : new Response("ok");
      };
      const response = await wrap(
        fetch,
        createPaymentOptions(protocol),
      )(new Request(url, { headers: { "X-Caller": "keep-me" } }));
      t.equal(response.status, 200);
      t.equal(calls, 2);
      t.end();
    },
  );

  const headerOverrides: HeadersInit[] = [
    {},
    new Headers({ "X-Override": "new" }),
    [["X-Override", "new"]],
  ];
  for (const headers of headerOverrides) {
    await t.test(`${protocol} honors init.headers replacement`, async (t) => {
      let calls = 0;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        t.notOk(request.headers.has("X-Caller"));
        t.equal(
          request.headers.get("X-Override"),
          new Headers(headers).get("X-Override"),
        );
        calls++;
        return calls === 1
          ? createPaymentResponse(protocol)
          : new Response("ok");
      };
      const response = await wrap(fetch, createPaymentOptions(protocol))(
        new Request(url, { headers: { "X-Caller": "old" } }),
        { headers },
      );
      t.equal(response.status, 200);
      t.equal(calls, 2);
      t.end();
    });
  }

  await t.test(
    `${protocol} replays POST Request across retry cycles`,
    async (t) => {
      let calls = 0;
      const controller = new AbortController();
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        t.equal(request.method, "POST");
        t.equal(request.headers.get("X-Caller"), "keep-me");
        t.equal(request.headers.has(paymentHeader), calls % 2 === 1);
        t.equal(request.credentials, "include");
        t.equal(request.redirect, "manual");
        t.equal(request.signal.aborted, false);
        t.equal(await request.text(), body);
        calls++;
        return calls < 4 ? createPaymentResponse(protocol) : new Response("ok");
      };
      const response = await wrap(
        fetch,
        createPaymentOptions(protocol),
      )(
        new Request(url, {
          method: "POST",
          headers: { "X-Caller": "keep-me" },
          body,
          credentials: "include",
          redirect: "manual",
          signal: controller.signal,
        }),
      );
      t.equal(response.status, 200);
      t.equal(calls, 4);
      t.end();
    },
  );

  await t.test(`${protocol} replays init.body override`, async (t) => {
    let calls = 0;
    const init = {
      method: "PUT",
      body: new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode("override body"));
          stream.close();
        },
      }),
      duplex: "half",
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      t.equal(request.method, "PUT");
      t.equal(await request.text(), "override body");
      calls++;
      return calls === 1 ? createPaymentResponse(protocol) : new Response("ok");
    };
    const response = await wrap(fetch, createPaymentOptions(protocol))(
      new Request(url, { method: "POST", body }),
      init,
    );
    t.equal(response.status, 200);
    t.equal(calls, 2);
    t.end();
  });
}

await t.test("MPP matches the effective Request body digest", async (t) => {
  for (const override of [false, true]) {
    const expectedBody = override ? "override body" : body;
    const digest = await computeBodyDigest(
      new TextEncoder().encode(expectedBody).buffer,
    );
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      t.equal(await request.text(), expectedBody);
      calls++;
      return calls === 1
        ? createPaymentResponse("mpp", digest)
        : new Response("ok");
    };
    const response = await wrap(fetch, createPaymentOptions("mpp"))(
      new Request(url, { method: "POST", body }),
      override ? { body: expectedBody } : undefined,
    );
    t.equal(response.status, 200);
    t.equal(calls, 2);
  }
  t.end();
});

await t.test(
  "non-402 Request response passes through without payment",
  async (t) => {
    const expected = new Response("unavailable", { status: 503 });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      t.equal(await request.text(), body);
      return expected;
    };
    const response = await wrap(fetch, { handlers: [] })(
      new Request(url, { method: "POST", body }),
    );
    t.equal(response, expected);
    t.end();
  },
);

function createOpenBody() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelCount = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(new TextEncoder().encode(body));
    },
    cancel() {
      cancelCount++;
    },
  });
  return {
    stream,
    getCancelCount: () => cancelCount,
    close() {
      if (cancelCount === 0) controller?.close();
    },
  };
}

for (const changeSource of [false, true]) {
  await t.test(
    `replayed bytes are isolated from Buffer mutation (source=${changeSource})`,
    async (t) => {
      const chunk = Buffer.from(body);
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      });
      let calls = 0;
      const transport: typeof fetch = async (input) => {
        if (!(input instanceof Request) || !input.body) {
          throw new Error("expected Request body");
        }
        const reader = input.body.getReader();
        const result = await reader.read();
        t.equal(new TextDecoder().decode(result.value), body);
        if (calls++ === 0) {
          if (changeSource) chunk.fill(88);
          else result.value?.fill(88);
          await reader.cancel();
          return createPaymentResponse("x402v2");
        }
        await reader.cancel();
        return new Response("ok");
      };
      const response = await wrap(
        transport,
        createPaymentOptions("x402v2"),
      )(createStreamingRequest(source));
      t.equal(response.status, 200);
      t.equal(calls, 2);
    },
  );
}

function createStreamingRequest(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  const init = {
    method: "POST",
    body: stream,
    duplex: "half",
    ...(signal ? { signal } : {}),
  };
  return new Request(url, init);
}

async function withDeadline<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("request did not complete")),
      1000,
    );
  });
  return await Promise.race([work, deadline]).finally(() =>
    clearTimeout(timer),
  );
}

for (const protocol of protocols) {
  await t.test(
    `${protocol} skips unnecessary digest reads on an open body`,
    async (t) => {
      const source = createOpenBody();
      let paidCalls = 0;
      const options = createPaymentOptions(protocol);
      options.mppHandlers = createPaymentOptions("mpp").mppHandlers ?? [];
      options.phase1Fetch = async () => createPaymentResponse(protocol);
      const paidFetch: typeof fetch = async (input) => {
        if (!(input instanceof Request) || !input.body) {
          throw new Error("expected Request body");
        }
        const reader = input.body.getReader();
        const chunk = await reader.read();
        t.equal(new TextDecoder().decode(chunk.value), body);
        await reader.cancel();
        paidCalls++;
        return new Response("ok");
      };
      const work = wrap(
        paidFetch,
        options,
      )(createStreamingRequest(source.stream));
      try {
        t.equal((await withDeadline(work)).status, 200);
        t.equal(paidCalls, 1);
        t.equal(source.getCancelCount(), 1, "source released when call ends");
      } finally {
        source.close();
        await withDeadline(work).catch(() => undefined);
      }
    },
  );
}

for (const open of [false, true]) {
  await t.test(
    `non-402 body cancellation completes (open=${open})`,
    async (t) => {
      const source = createOpenBody();
      const expected = new Response("ok");
      const transport: typeof fetch = async (input) => {
        if (!(input instanceof Request) || !input.body) {
          throw new Error("expected Request body");
        }
        await input.body.cancel();
        return expected;
      };
      const requestInit = {
        method: "POST",
        body: open ? source.stream : body,
        duplex: "half",
      };
      const work = wrap(transport, { handlers: [] })(
        new Request(url, requestInit),
      );
      try {
        t.equal(await withDeadline(work), expected);
        if (open) t.equal(source.getCancelCount(), 1);
      } finally {
        source.close();
        await withDeadline(work).catch(() => undefined);
      }
    },
  );
}

await t.test("transport failure releases the replay source", async (t) => {
  const source = createOpenBody();
  const failure = new Error("transport failed");
  const transport: typeof fetch = async () => {
    throw failure;
  };
  const work = wrap(
    transport,
    createPaymentOptions("x402v2"),
  )(createStreamingRequest(source.stream));
  try {
    await t.rejects(withDeadline(work), failure);
    t.equal(source.getCancelCount(), 1);
  } finally {
    source.close();
  }
});

await t.test(
  "caller abort interrupts a required MPP digest read",
  async (t) => {
    let sourceController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    let markReading: (() => void) | undefined;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    let cancelCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
        controller.enqueue(new TextEncoder().encode(body));
      },
      pull() {
        markReading?.();
      },
      cancel() {
        cancelCount++;
      },
    });
    const controller = new AbortController();
    const reason = new Error("caller canceled");
    const digest = await computeBodyDigest(
      new TextEncoder().encode(body).buffer,
    );
    let paidCalls = 0;
    const options = createPaymentOptions("mpp");
    options.phase1Fetch = async () => createPaymentResponse("mpp", digest);
    const transport: typeof fetch = async () => {
      paidCalls++;
      return new Response("ok");
    };
    const work = wrap(
      transport,
      options,
    )(createStreamingRequest(stream, controller.signal));
    try {
      await withDeadline(reading);
      controller.abort(reason);
      await t.rejects(withDeadline(work), reason);
      t.equal(paidCalls, 0);
      t.equal(cancelCount, 1);
    } finally {
      if (cancelCount === 0) sourceController?.close();
      await withDeadline(work).catch(() => undefined);
    }
  },
);

await t.test("native Request body capabilities survive replay", async (t) => {
  const received: { path?: string; body: string }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url === "/early") {
        response.writeHead(200);
        response.flushHeaders();
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({
        ...(request.url ? { path: request.url } : {}),
        body: Buffer.concat(chunks).toString(),
      });
      if (request.url === "/redirect") {
        response.writeHead(307, { Location: "/destination" });
      }
      response.end(
        request.url === "/early" ? Buffer.concat(chunks).toString() : "ok",
      );
    })().catch((error: unknown) => {
      response.destroy(
        error instanceof Error
          ? error
          : new Error("request failed", { cause: error }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    for (const init of [
      { keepalive: true },
      { mode: "no-cors" as const },
      {
        mode: "same-origin" as const,
        cache: "only-if-cached" as const,
        keepalive: true,
      },
      { mode: "same-origin" as const, cache: "only-if-cached" as const },
      {},
    ]) {
      const path =
        "cache" in init
          ? "/cached"
          : "mode" in init
            ? "/no-cors"
            : "keepalive" in init
              ? "/keepalive"
              : "/redirect";
      const request = new Request(baseURL + path, {
        method: "POST",
        body,
        ...init,
      });
      const response = await wrap(
        fetch,
        createPaymentOptions("x402v2"),
      )(request);
      t.equal(response.status, 200);
      t.equal(await response.text(), "ok");
    }
    t.same(
      received.map((request) => request.path),
      [
        "/keepalive",
        "/no-cors",
        "/cached",
        "/cached",
        "/redirect",
        "/destination",
      ],
    );
    t.ok(received.every((request) => request.body === body));

    let parts = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (parts++ < 5) controller.enqueue(new TextEncoder().encode("part"));
        else controller.close();
      },
    });
    const streamInit = { method: "POST", body: stream, duplex: "half" };
    const response = await wrap(
      fetch,
      createPaymentOptions("x402v2"),
    )(new Request(baseURL + "/early", streamInit));
    t.equal(await withDeadline(response.text()), "part".repeat(5));
    t.equal(received.at(-1)?.body, "part".repeat(5));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const streaming of [false, true]) {
  for (const transform of [false, true]) {
    await t.test(
      `returned response retains request body (stream=${streaming}, transform=${transform})`,
      async (t) => {
        const source = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          },
        });
        const request = streaming
          ? createStreamingRequest(source)
          : new Request(url, { method: "POST", body });
        const transport: typeof fetch = async (input) => {
          if (!(input instanceof Request) || !input.body)
            throw new Error("expected body");
          return new Response(
            transform
              ? input.body.pipeThrough(
                  new TransformStream<Uint8Array, Uint8Array>(),
                )
              : input.body,
          );
        };
        const response = await wrap(
          transport,
          createPaymentOptions("x402v2"),
        )(request);
        t.equal(await withDeadline(response.text()), body);
      },
    );
  }
}

await t.test(
  "canceling a returned response releases its upload source",
  async (t) => {
    const source = createOpenBody();
    const transport: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error("expected Request");
      return new Response(input.body);
    };
    const response = await wrap(
      transport,
      createPaymentOptions("x402v2"),
    )(createStreamingRequest(source.stream));
    await response.body?.cancel();
    t.equal(source.getCancelCount(), 1);
  },
);

for (const masked of [false, true]) {
  await t.test(
    `byte chunks from another realm replay (${masked})`,
    async (t) => {
      const chunk: unknown = runInNewContext("new Uint8Array([65, 66, 67])");
      if (masked)
        Object.defineProperty(chunk, Symbol.toStringTag, { value: "masked" });
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      });
      const init = { method: "POST", body: stream, duplex: "half" };
      const bodies: string[] = [];
      const transport: typeof fetch = async (input) => {
        if (!(input instanceof Request)) throw new Error("expected Request");
        bodies.push(await input.text());
        return bodies.length === 1
          ? createPaymentResponse("x402v2")
          : new Response("ok");
      };
      const response = await wrap(
        transport,
        createPaymentOptions("x402v2"),
      )(new Request(url, init));
      t.equal(response.status, 200);
      t.same(bodies, ["ABC", "ABC"]);
    },
  );
}

for (const chunk of [
  "invalid chunk",
  4,
  new Int8Array([4]),
  new Uint8ClampedArray([4]),
  new DataView(new ArrayBuffer(1)),
]) {
  const kind = ArrayBuffer.isView(chunk)
    ? chunk.constructor.name
    : typeof chunk;
  await t.test(`invalid request chunks reject (${kind})`, async (t) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const init = { method: "POST", body: stream, duplex: "half" };
    const transport: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error("expected Request");
      await new Response(input.body).text();
      return new Response("ok");
    };
    await t.rejects(
      wrap(transport, createPaymentOptions("x402v2"))(new Request(url, init)),
      TypeError,
    );
  });
}

for (const streaming of [false, true]) {
  await t.test(
    `Request referrer settings survive retries (${streaming})`,
    async (t) => {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      const init = {
        method: "POST",
        body: streaming ? source : body,
        duplex: "half",
        referrer: "https://example.com/caller",
        referrerPolicy: "no-referrer" as const,
      };
      const request = new Request(url, init);
      let calls = 0;
      const transport: typeof fetch = async (input, init) => {
        if (!(input instanceof Request)) throw new Error("expected Request");
        t.equal(input.referrer, request.referrer);
        t.equal(input.referrerPolicy, request.referrerPolicy);
        t.equal(init?.referrer, request.referrer);
        t.equal(init?.referrerPolicy, request.referrerPolicy);
        t.equal(await input.text(), body);
        return ++calls === 1
          ? createPaymentResponse("x402v2")
          : new Response("ok");
      };
      const response = await wrap(
        transport,
        createPaymentOptions("x402v2"),
      )(request);
      t.equal(response.status, 200);
    },
  );
}

await t.test("null init is an empty Fetch options dictionary", async (t) => {
  const transport: typeof fetch = async () => new Response("ok");
  for (const input of [url, new URL(url), new Request(url)]) {
    t.equal(
      (await wrap(transport, createPaymentOptions("x402v2"))(input, null))
        .status,
      200,
    );
  }
});

await t.test(
  "a body error remains fatal after the transport catches it",
  async (t) => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("A"));
        controller.enqueue("invalid chunk");
        controller.enqueue(new TextEncoder().encode("C"));
        controller.close();
      },
    });
    const init = { method: "POST", body: source, duplex: "half" };
    let calls = 0;
    let bodyError: unknown;
    let payments = 0;
    const options = createPaymentOptions("x402v2");
    options.handlers = [
      async () => {
        payments++;
        return [];
      },
    ];
    const transport: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error("expected Request");
      calls++;
      try {
        await input.text();
      } catch (error) {
        bodyError = error;
      }
      return createPaymentResponse("x402v2");
    };
    const work = wrap(transport, options)(new Request(url, init));
    await t.rejects(work, TypeError);
    t.equal(calls, 1);
    t.type(bodyError, TypeError);
    t.equal(payments, 0);
  },
);

await t.test(
  "URL calls preserve the first transport invocation timing",
  async (t) => {
    for (const input of [url, new URL(url)]) {
      const headers = new Headers({ "X-Caller": "original" });
      let seen: string | null = null;
      const transport: typeof fetch = async (_input, init) => {
        seen = new Headers(init?.headers).get("X-Caller");
        return new Response("ok");
      };
      const work = wrap(transport, createPaymentOptions("x402v2"))(input, {
        headers,
      });
      headers.set("X-Caller", "changed");
      t.equal(seen, "original");
      t.equal((await work).status, 200);
    }
  },
);
