export type MockFetchType = typeof fetch;
export type MockResponse = Response;

export function responseFeeder(
  responses: (MockFetchType | MockResponse)[],
): MockFetchType {
  return async (input, init?) => {
    const t = responses.shift();

    if (t === undefined) {
      throw new Error("out of responses to feed");
    }

    if (t instanceof Function) {
      return t(input, init);
    }

    return t;
  };
}
