function hasStaticBody(request: Request) {
  let probe = request.clone();
  try {
    // Fetch permits no-cors bodies only when their source can be replayed.
    // Keep that source capability for redirects and keepalive requests.
    probe = new Request(probe, {
      method: "POST",
      mode: "no-cors",
      cache: "default",
    });
    return true;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return false;
  } finally {
    void probe.body?.cancel().catch(() => undefined);
  }
}

export function createRequestReplay(request: Request) {
  const staticBody = request.body !== null && hasStaticBody(request);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  const active = new Set<{ index: number; stop: () => void }>();
  let offset = 0;
  let ended = reader === undefined;
  let released = false;
  let disposed = false;
  let pendingRead: Promise<void> | undefined;
  let bufferedBody: Promise<ArrayBuffer> | undefined;
  let sourceError: { error: unknown } | undefined;

  const cancelSource = () => {
    void reader?.cancel(request.signal.reason).catch(() => undefined);
  };
  request.signal.addEventListener("abort", cancelSource, { once: true });
  if (request.signal.aborted) cancelSource();

  function throwIfFailed() {
    if (sourceError) throw sourceError.error;
  }

  function releaseConsumed() {
    if (!released) return;
    if (active.size === 0) {
      disposed = true;
      chunks.length = 0;
      request.signal.removeEventListener("abort", cancelSource);
      cancelSource();
    } else {
      const first = Math.min(...Array.from(active, (body) => body.index));
      chunks.splice(0, first - offset);
      offset = first;
    }
  }

  function createBody() {
    let closed = false;
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const finish = () => {
      closed = true;
      active.delete(body);
      releaseConsumed();
    };
    const body = {
      index: 0,
      stop() {
        if (closed) return;
        streamController?.close();
        finish();
      },
    };
    active.add(body);
    return new ReadableStream<Uint8Array>(
      {
        start(controller) {
          streamController = controller;
        },
        async pull(controller) {
          try {
            request.signal.throwIfAborted();
            throwIfFailed();
            if (
              !disposed &&
              body.index === offset + chunks.length &&
              !ended &&
              reader
            ) {
              pendingRead ??= reader
                .read()
                .then(({ done, value }) => {
                  if (done) ended = true;
                  else if (!disposed) {
                    if (
                      !ArrayBuffer.isView(value) ||
                      Reflect.get(
                        Uint8Array.prototype,
                        Symbol.toStringTag,
                        value,
                      ) !== "Uint8Array"
                    ) {
                      throw new TypeError(
                        "Request body must yield Uint8Array chunks",
                      );
                    }
                    chunks.push(new Uint8Array(value));
                  }
                })
                .catch((error: unknown) => {
                  sourceError = { error };
                  throw error;
                })
                .finally(() => {
                  pendingRead = undefined;
                });
              await pendingRead;
            }
            if (closed) return;
            request.signal.throwIfAborted();
            const chunk = chunks[body.index - offset];
            if (disposed || chunk === undefined) body.stop();
            else {
              body.index++;
              controller.enqueue(new Uint8Array(chunk));
              releaseConsumed();
            }
          } catch (error) {
            if (!closed) controller.error(error);
            finish();
          }
        },
        // Keep the source available for a possible paid retry. Canceling an
        // attempt must not wait for an unread replay branch to be canceled.
        cancel() {
          finish();
        },
      },
      { highWaterMark: 0 },
    );
  }

  return {
    async createRequest() {
      request.signal.throwIfAborted();
      throwIfFailed();
      for (const body of active) body.stop();
      const metadata = {
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
      };
      if (staticBody) {
        bufferedBody ??= new Response(createBody()).arrayBuffer();
        const body = await bufferedBody;
        request.signal.throwIfAborted();
        return new Request(request, { body: new Blob([body]), ...metadata });
      }
      const init = reader
        ? { body: createBody(), duplex: "half", ...metadata }
        : {};
      return new Request(request, init);
    },
    readBody: () => new Response(createBody()).arrayBuffer(),
    throwIfFailed,
    dispose(force = false) {
      released = true;
      if (force) for (const body of active) body.stop();
      releaseConsumed();
    },
  };
}
