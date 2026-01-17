import type { RequestMatcher } from "./types";

export const matchFacilitatorAccepts: RequestMatcher = (url) =>
  url.includes("/facilitator/accepts");

export const matchFacilitatorVerify: RequestMatcher = (url) =>
  url.includes("/facilitator/verify");

export const matchFacilitatorSettle: RequestMatcher = (url) =>
  url.includes("/facilitator/settle");

export const matchFacilitatorSupported: RequestMatcher = (url) =>
  url.includes("/facilitator/supported");

export const matchFacilitator: RequestMatcher = (url) =>
  matchFacilitatorAccepts(url) ||
  matchFacilitatorVerify(url) ||
  matchFacilitatorSettle(url) ||
  matchFacilitatorSupported(url);

export const matchResource: RequestMatcher = (url) => !matchFacilitator(url);

export function and(...matchers: RequestMatcher[]): RequestMatcher {
  return (url, init) => matchers.every((m) => m(url, init));
}

export function or(...matchers: RequestMatcher[]): RequestMatcher {
  return (url, init) => matchers.some((m) => m(url, init));
}

export function not(matcher: RequestMatcher): RequestMatcher {
  return (url, init) => !matcher(url, init);
}

export function matchURL(pattern: string | RegExp): RequestMatcher {
  if (typeof pattern === "string") {
    return (url) => url.includes(pattern);
  }
  return (url) => pattern.test(url);
}

export function matchMethod(method: string): RequestMatcher {
  const upperMethod = method.toUpperCase();
  return (_url, init) => (init?.method?.toUpperCase() ?? "GET") === upperMethod;
}

export const matchAll: RequestMatcher = () => true;

export const matchNone: RequestMatcher = () => false;
