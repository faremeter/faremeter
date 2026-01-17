export function getURLFromRequestInfo(
  input: RequestInfo | URL | string,
): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}
