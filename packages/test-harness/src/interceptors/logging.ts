import type { Interceptor } from "./types";
import { getURLFromRequestInfo } from "./utils";

export type LogEvent = {
  type: "request" | "response" | "error";
  url: string;
  method?: string;
  status?: number;
  error?: string;
  timestamp: number;
};

export function createLoggingInterceptor(
  log: (event: LogEvent) => void,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);
    const method = init?.method ?? "GET";

    log({
      type: "request",
      url,
      method,
      timestamp: Date.now(),
    });

    try {
      const response = await fetch(input, init);

      log({
        type: "response",
        url,
        method,
        status: response.status,
        timestamp: Date.now(),
      });

      return response;
    } catch (error) {
      log({
        type: "error",
        url,
        method,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });

      throw error;
    }
  };
}

export function createConsoleLoggingInterceptor(
  prefix = "[test-harness]",
  log: {
    log: (msg: string) => void;
    error: (msg: string) => void;
  } = console,
): Interceptor {
  return createLoggingInterceptor((event) => {
    if (event.type === "request") {
      log.log(`${prefix} ${event.method} ${event.url}`);
    } else if (event.type === "response") {
      log.log(`${prefix} ${event.method} ${event.url} -> ${event.status}`);
    } else {
      log.error(`${prefix} ${event.method} ${event.url} ERROR: ${event.error}`);
    }
  });
}

export function createEventCollector(): {
  interceptor: Interceptor;
  events: LogEvent[];
  clear: () => void;
} {
  const events: LogEvent[] = [];

  return {
    interceptor: createLoggingInterceptor((event) => events.push(event)),
    events,
    clear: () => {
      events.length = 0;
    },
  };
}
