import type { FieldRef, RouteConfig } from "../types.js";
import { convertPath } from "../path.js";
import { generateAccessBlock } from "../lua/access.js";
import { generateHeaderFilterBlock } from "../lua/header-filter.js";
import { generateBodyFilterBlock } from "../lua/body-filter.js";
import { generateLogBlock } from "../lua/log.js";
import { generateWebSocketBlock } from "../lua/websocket.js";

function deduplicateFields(fields: FieldRef[]): FieldRef[] {
  const seen = new Set<string>();
  return fields.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

type LocationOpts = {
  sidecarURL: string;
  upstreamURL: string;
  specRoot?: string | undefined;
};

type LocationResult = {
  block: string;
  warnings: string[];
};

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}

function luaBlock(directive: string, code: string): string {
  return `${directive} {\n${indent(code, 2)}\n}`;
}

function groupRoutesByPath(routes: RouteConfig[]): Map<string, RouteConfig[]> {
  const groups = new Map<string, RouteConfig[]>();
  for (const route of routes) {
    const existing = groups.get(route.path);
    if (existing) {
      existing.push(route);
    } else {
      groups.set(route.path, [route]);
    }
  }
  return groups;
}

function generatePaidHTTPLocation(
  pathDirective: string,
  routes: RouteConfig[],
  opts: LocationOpts,
  extraDirectives?: string,
): string {
  const { sidecarURL } = opts;
  const accessCode = generateAccessBlock({ routes, sidecarURL });
  const lines: string[] = [];

  // proxy_buffering takes a literal `on | off` at config load time —
  // it cannot be driven by a runtime variable. For SSE transports we
  // need to stream upstream chunks to the client as they arrive, so
  // disable buffering at the location level when any route on this
  // path is SSE. Non-SSE locations keep nginx's default buffering.
  const hasSSE = routes.some((r) => r.transportType === "sse");
  lines.push(`location ${pathDirective} {`);
  if (hasSSE) {
    lines.push("  proxy_buffering off;");
  }

  // Caller-supplied extra directives (currently used by the mixed
  // HTTP+WebSocket path to insert an Upgrade-detection jump into a
  // named WS location). Placed before the access_by_lua block so the
  // upgrade redirect short-circuits before any paid-request logic
  // runs — an upgrade request should never increment billing.
  if (extraDirectives) {
    lines.push(extraDirectives);
  }

  lines.push("");
  lines.push(indent(luaBlock("access_by_lua_block", accessCode), 4));

  const captureFields = deduplicateFields(
    routes.flatMap((r) => r.captureFields),
  );

  if (captureFields.length > 0) {
    const headerFilterCode = generateHeaderFilterBlock({ captureFields });
    const bodyFilterCode = generateBodyFilterBlock({ captureFields });

    lines.push("");
    lines.push(
      indent(luaBlock("header_filter_by_lua_block", headerFilterCode), 4),
    );
    lines.push("");
    lines.push(indent(luaBlock("body_filter_by_lua_block", bodyFilterCode), 4));
  }

  // The log block must always be emitted for priced routes, even
  // when there are no response-body fields to capture. One-phase
  // rules (capture-only with a literal expression like "1") have
  // empty captureFields but still need the /response call so the
  // sidecar can settle the payment.
  const logCode = generateLogBlock(sidecarURL);
  lines.push("");
  lines.push(indent(luaBlock("log_by_lua_block", logCode), 4));

  lines.push("");
  lines.push(`    proxy_pass ${opts.upstreamURL};`);
  lines.push("    proxy_set_header Host $host;");
  lines.push("    proxy_set_header X-Real-IP $remote_addr;");
  lines.push("}");

  return lines.join("\n");
}

function generatePaidWebSocketLocation(
  pathDirective: string,
  route: RouteConfig,
  opts: LocationOpts,
): string {
  const { sidecarURL, upstreamURL } = opts;

  const accessCode = generateAccessBlock({ routes: [route], sidecarURL });

  const wsUpstreamURL = upstreamURL
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
  const contentCode = generateWebSocketBlock(route, sidecarURL, wsUpstreamURL);

  const lines: string[] = [];

  lines.push(`location ${pathDirective} {`);
  lines.push("");
  lines.push(indent(luaBlock("access_by_lua_block", accessCode), 4));
  lines.push("");
  lines.push(indent(luaBlock("content_by_lua_block", contentCode), 4));
  lines.push("}");

  return lines.join("\n");
}

function generatePaidWebSocketUpgradeLocation(
  pathDirective: string,
  httpRoutes: RouteConfig[],
  wsRoute: RouteConfig,
  opts: LocationOpts,
  wsIndex: number,
): string {
  const { sidecarURL, upstreamURL } = opts;
  const allRoutes = [...httpRoutes, wsRoute];

  const wsUpstreamURL = upstreamURL
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
  const contentCode = generateWebSocketBlock(
    wsRoute,
    sidecarURL,
    wsUpstreamURL,
  );
  const wsAccessCode = generateAccessBlock({
    routes: [wsRoute],
    sidecarURL,
  });

  // nginx named locations need only be unique within the config
  // file. A monotonic counter assigned in registration order
  // satisfies that without hashing or sanitization.
  const wsLocationName = `@ws_${wsIndex}`;

  const wsLines: string[] = [];
  wsLines.push(`location ${wsLocationName} {`);
  wsLines.push(indent(luaBlock("access_by_lua_block", wsAccessCode), 4));
  wsLines.push("");
  wsLines.push(indent(luaBlock("content_by_lua_block", contentCode), 4));
  wsLines.push("}");

  // nginx's `rewrite` directive does not accept a named location as
  // its replacement — named locations are reachable only via
  // `error_page`, `try_files`, or an internal redirect. Use the
  // error_page idiom: map a synthetic status (418 — "I'm a teapot",
  // unlikely to collide with any real upstream status) to the named
  // WS location, then `return 418` from the conditional to take
  // that jump.
  const upgradeRedirect = [
    `  error_page 418 = ${wsLocationName};`,
    `  if ($http_upgrade ~* "websocket") {`,
    "    return 418;",
    "  }",
  ].join("\n");

  const httpLocation = generatePaidHTTPLocation(
    pathDirective,
    allRoutes,
    opts,
    upgradeRedirect,
  );

  return wsLines.join("\n") + "\n\n" + httpLocation;
}

/**
 * Reject characters that would break out of the `root <value>;`
 * nginx directive. A double quote, newline, or semicolon in the
 * value lets a caller inject arbitrary config.
 */
function validateNginxValue(label: string, value: string): void {
  const check = (bad: string, name: string) => {
    if (value.includes(bad)) {
      throw new Error(
        `invalid ${label} ${JSON.stringify(value)}: ` +
          `contains a ${name} which would break out of the nginx directive`,
      );
    }
  };
  check('"', "double quote");
  check("\n", "newline");
  check(";", "semicolon");
}

function generateSpecEndpoint(specRoot: string): string {
  validateNginxValue("specRoot", specRoot);
  const lines: string[] = [];
  lines.push("location = /.well-known/openapi.yaml {");
  lines.push(`    root ${specRoot};`);
  lines.push("    try_files /openapi.yaml =404;");
  lines.push("}");
  return lines.join("\n");
}

export function generateLocationBlocks(
  routes: RouteConfig[],
  opts: LocationOpts,
): LocationResult {
  validateNginxValue("upstreamURL", opts.upstreamURL);

  const warnings: string[] = [];
  const blocks: string[] = [];

  if (opts.specRoot) {
    blocks.push(generateSpecEndpoint(opts.specRoot));
  }

  const groups = groupRoutesByPath(routes);

  let wsUpgradeIndex = 0;
  for (const [path, pathRoutes] of groups) {
    const { directive, warnings: pathWarnings } = convertPath(path);
    warnings.push(...pathWarnings);

    const httpRoutes = pathRoutes.filter(
      (r) => r.transportType !== "websocket",
    );
    const wsRoutes = pathRoutes.filter((r) => r.transportType === "websocket");

    const firstWsRoute = wsRoutes[0];
    if (httpRoutes.length > 0 && firstWsRoute) {
      if (wsRoutes.length > 1) {
        warnings.push(
          `Path "${path}" declares ${wsRoutes.length} WebSocket operations; ` +
            `only the first (${firstWsRoute.method}) will be routed. Drop the ` +
            `extras or move them to distinct paths.`,
        );
      }
      warnings.push(
        `Path "${path}" has both HTTP and WebSocket routes; generating separate location blocks with WebSocket upgrade detection`,
      );
      blocks.push(
        generatePaidWebSocketUpgradeLocation(
          directive,
          httpRoutes,
          firstWsRoute,
          opts,
          wsUpgradeIndex++,
        ),
      );
    } else if (httpRoutes.length > 0) {
      blocks.push(generatePaidHTTPLocation(directive, httpRoutes, opts));
    } else if (firstWsRoute) {
      // A single path can only produce one `location = /path` block —
      // nginx rejects duplicates at config load time with `[emerg]
      // duplicate location`. Route the first WS operation and warn
      // about extras so the spec author can move them to distinct
      // paths. This mirrors the mixed HTTP + multi-WS branch above.
      if (wsRoutes.length > 1) {
        warnings.push(
          `Path "${path}" declares ${wsRoutes.length} WebSocket operations; ` +
            `only the first (${firstWsRoute.method}) will be routed. Drop the ` +
            `extras or move them to distinct paths.`,
        );
      }
      blocks.push(generatePaidWebSocketLocation(directive, firstWsRoute, opts));
    }
  }

  return {
    block: blocks.join("\n\n"),
    warnings,
  };
}
