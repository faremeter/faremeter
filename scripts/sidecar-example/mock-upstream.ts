import { Hono } from "hono";
import { serve } from "@hono/node-server";

const MOCK_PORT = 4100;

const app = new Hono();

app.post("/v1/chat/completions", (c) => {
  return c.json({
    id: "chatcmpl-test-001",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content: "Hello from mock" } }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  });
});

app.post("/v1/chat/stream", (_c) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const chunks = [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
        {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        },
      ];

      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.post("/v1/images/generations", (c) => {
  return c.json({
    data: [{ url: "https://example.com/img.png" }],
    usage: { count: 1 },
  });
});

app.get("/v1/data", (c) => {
  return c.json({
    items: [{ id: 1 }, { id: 2 }],
  });
});

app.post("/v1/data", (c) => {
  return c.json({
    created: true,
    usage: { count: 5 },
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

const server = serve({ fetch: app.fetch, port: MOCK_PORT }, () => {
  process.stderr.write(`mock upstream listening on port ${MOCK_PORT}\n`);
});

process.on("SIGTERM", () => {
  server.close();
});
