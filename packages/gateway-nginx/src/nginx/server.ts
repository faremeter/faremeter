function extractHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function isIPAddress(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith("[");
}

function needsResolver(urls: string[]): boolean {
  for (const url of urls) {
    const host = extractHost(url);
    if (host && !isIPAddress(host)) return true;
  }
  return false;
}

function extractHostPort(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port;
    if (port) return `${host}:${port}`;
    if (parsed.protocol === "https:") return `${host}:443`;
    return `${host}:80`;
  } catch {
    return url;
  }
}

type ServerBlockOpts = {
  upstreamURL: string;
  sidecarURL: string;
  luaPackagePath: string;
};

export function generateServerBlock(opts: ServerBlockOpts): string {
  const { upstreamURL, sidecarURL, luaPackagePath } = opts;
  const resolver = needsResolver([upstreamURL, sidecarURL]);
  const upstreamServer = extractHostPort(upstreamURL);

  const lines: string[] = [];

  lines.push("http {");
  lines.push("  lua_shared_dict fm_capture_buffer 10m;");
  lines.push(`  lua_package_path "${luaPackagePath}/?.lua;;";`);
  lines.push("  lua_max_pending_timers 4096;");
  lines.push("  lua_max_running_timers 1024;");
  lines.push("");

  if (resolver) {
    lines.push("  resolver local=on;");
    lines.push("");
  }

  lines.push("  upstream backend {");
  lines.push(`    server ${upstreamServer};`);
  lines.push("  }");
  lines.push("");
  lines.push("  server {");
  lines.push("    listen 8080;");
  lines.push("");
  lines.push("    client_body_buffer_size 10m;");
  lines.push("    client_max_body_size 10m;");
  lines.push("    proxy_buffering on;");

  return lines.join("\n");
}

export function generateServerBlockClose(): string {
  return ["  }", "}"].join("\n");
}
