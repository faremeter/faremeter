export type Interceptor = (
  fetch: typeof globalThis.fetch,
) => typeof globalThis.fetch;

/**
 * Compose multiple interceptors into a single interceptor.
 *
 * Interceptors are applied right-to-left (last interceptor wraps innermost).
 * This means the first interceptor in the array sees the request first and
 * the response last.
 *
 * @example
 * ```ts
 * const composed = composeInterceptors(
 *   loggingInterceptor,    // Sees request first, response last
 *   failureInterceptor,    // Sees request second
 *   delayInterceptor,      // Innermost - closest to actual fetch
 * );
 * ```
 */
export function composeInterceptors(
  ...interceptors: Interceptor[]
): Interceptor {
  return (baseFetch) =>
    interceptors.reduceRight(
      (fetch, interceptor) => interceptor(fetch),
      baseFetch,
    );
}

export type RequestMatcher = (url: string, init?: RequestInit) => boolean;
