export type WaitForHealthOptions = {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

export async function waitForHealth(
  url: string,
  opts: WaitForHealthOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxDelayMs = opts.maxDelayMs ?? 1_000;
  let delay = opts.initialDelayMs ?? 50;
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health check returned ${response.status}`);
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, maxDelayMs);
  }

  throw new Error(`timed out waiting for ${url} after ${timeoutMs}ms`, {
    cause: lastError,
  });
}
