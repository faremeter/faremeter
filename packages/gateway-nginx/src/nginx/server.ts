// No server block generation — the operator owns the server { }
// wrapper. The generator only produces location blocks.
//
// This file is kept for the extractHostPort utility used by tests
// and for backward compatibility with imports.

function parseUpstreamURL(url: string): URL {
  try {
    return new URL(url);
  } catch (cause) {
    throw new Error(
      `invalid upstream/sidecar URL ${JSON.stringify(url)}: ` +
        `must be a well-formed absolute URL (e.g. http://host:port)`,
      { cause },
    );
  }
}

function isIPAddress(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith("[");
}

function needsResolver(urls: string[]): boolean {
  for (const url of urls) {
    const host = parseUpstreamURL(url).hostname;
    if (host && !isIPAddress(host)) return true;
  }
  return false;
}

function extractHostPort(url: string): string {
  const parsed = parseUpstreamURL(url);
  const host = parsed.hostname;
  if (!host) {
    throw new Error(`upstream URL ${JSON.stringify(url)} has no hostname`);
  }
  const port = parsed.port;
  if (port) return `${host}:${port}`;
  if (parsed.protocol === "https:") return `${host}:443`;
  return `${host}:80`;
}

export { needsResolver, extractHostPort };
