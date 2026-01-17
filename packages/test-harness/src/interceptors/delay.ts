import type { Interceptor, RequestMatcher } from "./types";
import { getURLFromRequestInfo } from "./utils";

export function createDelayInterceptor(
  match: RequestMatcher,
  delayMs: number,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);

    if (match(url, init)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return fetch(input, init);
  };
}

export function createResponseDelayInterceptor(
  match: RequestMatcher,
  delayMs: number,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);
    const response = await fetch(input, init);

    if (match(url, init)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return response;
  };
}

export function createVariableDelayInterceptor(
  match: RequestMatcher,
  getDelay: (url: string, init?: RequestInit) => number,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);

    if (match(url, init)) {
      const delayMs = getDelay(url, init);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return fetch(input, init);
  };
}
