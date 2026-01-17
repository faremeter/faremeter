import type { Interceptor, RequestMatcher } from "./types";
import { getURLFromRequestInfo } from "./utils";

export function createFailureInterceptor(
  match: RequestMatcher,
  failFn: () => Response | Error | Promise<Response | Error>,
): Interceptor {
  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);

    if (match(url, init)) {
      const result = await failFn();
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }

    return fetch(input, init);
  };
}

export function failOnce(
  match: RequestMatcher,
  failFn: () => Response | Error,
): Interceptor {
  let triggered = false;

  return createFailureInterceptor(
    (url, init) => {
      if (triggered) return false;
      return match(url, init);
    },
    () => {
      triggered = true;
      return failFn();
    },
  );
}

export function failNTimes(
  n: number,
  match: RequestMatcher,
  failFn: () => Response | Error,
): Interceptor {
  let count = 0;

  return createFailureInterceptor(
    (url, init) => {
      if (count >= n) return false;
      return match(url, init);
    },
    () => {
      count++;
      return failFn();
    },
  );
}

export function failUntilCleared(
  match: RequestMatcher,
  failFn: () => Response | Error,
): Interceptor & { clear(): void } {
  let active = true;

  const interceptor = createFailureInterceptor(
    (url, init) => active && match(url, init),
    failFn,
  ) as Interceptor & { clear(): void };

  interceptor.clear = () => {
    active = false;
  };

  return interceptor;
}

export function failWhen(
  match: RequestMatcher,
  shouldFail: (ctx: { url: string; attemptCount: number }) => boolean,
  failFn: () => Response | Error,
): Interceptor {
  const attemptCounts = new Map<string, number>();

  return (fetch) => async (input, init) => {
    const url = getURLFromRequestInfo(input);

    if (match(url, init)) {
      const attemptCount = (attemptCounts.get(url) ?? 0) + 1;
      attemptCounts.set(url, attemptCount);

      if (shouldFail({ url, attemptCount })) {
        const result = failFn();
        if (result instanceof Error) {
          throw result;
        }
        return result;
      }
    }

    return fetch(input, init);
  };
}
