import type { EvalContext } from "./types";

/**
 * Build an evaluation context from HTTP request data.
 */
export function buildContext(opts: {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  query?: Record<string, string>;
  path: string;
}): EvalContext {
  return {
    request: {
      body: opts.body,
      headers: opts.headers,
      query: opts.query ?? {},
      path: opts.path,
    },
  };
}

/**
 * Augment an evaluation context with HTTP response data for capture phase.
 */
export function withResponse(
  ctx: EvalContext,
  response: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
    status: number;
  },
): EvalContext {
  return {
    ...ctx,
    response: {
      body: response.body,
      headers: response.headers,
      status: response.status,
    },
  };
}
