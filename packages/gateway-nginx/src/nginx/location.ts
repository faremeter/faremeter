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
): string {
  const { sidecarURL } = opts;
  const accessCode = generateAccessBlock({ routes, sidecarURL });
  const lines: string[] = [];

  lines.push(`location ${pathDirective} {`);
  lines.push('  set $proxy_buffering "on";');
  lines.push("  proxy_buffering $proxy_buffering;");
  lines.push("");
  lines.push(indent(luaBlock("access_by_lua_block", accessCode), 4));

  const captureFields = deduplicateFields(
    routes.flatMap((r) => r.captureFields),
  );

  if (captureFields.length > 0) {
    const headerFilterCode = generateHeaderFilterBlock({ captureFields });
    const bodyFilterCode = generateBodyFilterBlock({ captureFields });
    const firstRoute = routes[0];
    if (!firstRoute) {
      throw new Error("generatePaidHTTPLocation requires at least one route");
    }
    const logCode = generateLogBlock(firstRoute, sidecarURL);

    lines.push("");
    lines.push(
      indent(luaBlock("header_filter_by_lua_block", headerFilterCode), 4),
    );
    lines.push("");
    lines.push(indent(luaBlock("body_filter_by_lua_block", bodyFilterCode), 4));
    lines.push("");
    lines.push(indent(luaBlock("log_by_lua_block", logCode), 4));
  }

  lines.push("");
  lines.push("    proxy_pass http://backend;");
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

  const wsLocationName = `@ws_${pathDirective.replace(/[^a-zA-Z0-9_]/g, "_")}`;

  const wsLines: string[] = [];
  wsLines.push(`location ${wsLocationName} {`);
  wsLines.push(indent(luaBlock("access_by_lua_block", wsAccessCode), 4));
  wsLines.push("");
  wsLines.push(indent(luaBlock("content_by_lua_block", contentCode), 4));
  wsLines.push("}");

  const httpLocation = generatePaidHTTPLocation(pathDirective, allRoutes, opts);

  const upgradeRedirect = [
    "",
    `    if ($http_upgrade ~* "websocket") {`,
    `      rewrite ^ ${wsLocationName} last;`,
    "    }",
  ].join("\n");

  const insertPoint = httpLocation.indexOf("\n\n    access_by_lua_block");
  if (insertPoint === -1) {
    return httpLocation + "\n\n" + wsLines.join("\n");
  }

  const combined =
    httpLocation.slice(0, insertPoint) +
    upgradeRedirect +
    httpLocation.slice(insertPoint);

  return wsLines.join("\n") + "\n\n" + combined;
}

function _generateUnpaidLocation(pathDirective: string): string {
  const lines: string[] = [];
  lines.push(`location ${pathDirective} {`);
  lines.push("    proxy_pass http://backend;");
  lines.push("    proxy_set_header Host $host;");
  lines.push("    proxy_set_header X-Real-IP $remote_addr;");
  lines.push("}");
  return lines.join("\n");
}

function generateSpecEndpoint(): string {
  const lines: string[] = [];
  lines.push("location = /.well-known/openapi.yaml {");
  lines.push("    root /etc/nginx;");
  lines.push("    try_files /openapi.yaml =404;");
  lines.push("}");
  return lines.join("\n");
}

export function generateLocationBlocks(
  routes: RouteConfig[],
  opts: LocationOpts,
): LocationResult {
  const warnings: string[] = [];
  const blocks: string[] = [];

  blocks.push(generateSpecEndpoint());

  const groups = groupRoutesByPath(routes);

  for (const [path, pathRoutes] of groups) {
    const { directive, warnings: pathWarnings } = convertPath(path);
    warnings.push(...pathWarnings);

    const httpRoutes = pathRoutes.filter(
      (r) => r.transportType !== "websocket",
    );
    const wsRoutes = pathRoutes.filter((r) => r.transportType === "websocket");

    const firstWsRoute = wsRoutes[0];
    if (httpRoutes.length > 0 && firstWsRoute) {
      warnings.push(
        `Path "${path}" has both HTTP and WebSocket routes; generating separate location blocks with WebSocket upgrade detection`,
      );
      blocks.push(
        generatePaidWebSocketUpgradeLocation(
          directive,
          httpRoutes,
          firstWsRoute,
          opts,
        ),
      );
    } else if (httpRoutes.length > 0) {
      blocks.push(generatePaidHTTPLocation(directive, httpRoutes, opts));
    } else if (wsRoutes.length > 0) {
      for (const wsRoute of wsRoutes) {
        blocks.push(generatePaidWebSocketLocation(directive, wsRoute, opts));
      }
    }
  }

  return {
    block: blocks.join("\n\n"),
    warnings,
  };
}
