import type { Interceptor, RequestMatcher } from "./types";
import { getURLFromRequestInfo } from "./utils";

export function createRequestHook(
  match: RequestMatcher,
  hook: (url: string, init?: RequestInit) => void | Promise<void>,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);

    if (match(url, init)) {
      await hook(url, init);
    }

    return fetch(input, init);
  };
}

export function createResponseHook(
  match: RequestMatcher,
  hook: (
    url: string,
    response: Response,
    init?: RequestInit,
  ) => void | Promise<void>,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);
    const response = await fetch(input, init);

    if (match(url, init)) {
      await hook(url, response, init);
    }

    return response;
  };
}

export function createHook(
  match: RequestMatcher,
  hooks: {
    onRequest?: (url: string, init?: RequestInit) => void | Promise<void>;
    onResponse?: (
      url: string,
      response: Response,
      init?: RequestInit,
    ) => void | Promise<void>;
  },
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);

    if (match(url, init) && hooks.onRequest) {
      await hooks.onRequest(url, init);
    }

    const response = await fetch(input, init);

    if (match(url, init) && hooks.onResponse) {
      await hooks.onResponse(url, response, init);
    }

    return response;
  };
}

type CapturedRequest = {
  url: string;
  init?: RequestInit | undefined;
  response: Response;
  timestamp: number;
};

export function createCaptureInterceptor(match: RequestMatcher): {
  interceptor: Interceptor;
  captured: CapturedRequest[];
  clear: () => void;
} {
  const captured: CapturedRequest[] = [];

  const interceptor: Interceptor = (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);
    const response = await fetch(input, init);

    if (match(url, init)) {
      captured.push({
        url,
        init,
        response: response.clone(), // Clone so the original can still be consumed
        timestamp: Date.now(),
      });
    }

    return response;
  };

  return {
    interceptor,
    captured,
    clear: () => {
      captured.length = 0;
    },
  };
}
