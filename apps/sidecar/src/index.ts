import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { configureApp } from "@faremeter/logs";
import {
  loadSpec,
  type HandlerBinding,
  type MPPBinding,
} from "@faremeter/middleware-openapi";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

await configureApp();

const DEFAULT_PORT = 4002;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    logger.fatal(`PORT must be an integer 1-65535, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

type HandlersModule = {
  bindings: HandlerBinding[];
  mppBindings?: MPPBinding[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadHandlersModule(specifier: string): Promise<HandlersModule> {
  const absPath = isAbsolute(specifier)
    ? specifier
    : resolve(process.cwd(), specifier);
  const url = pathToFileURL(absPath).href;

  const imported: unknown = await import(url);
  if (!isPlainObject(imported)) {
    throw new Error(
      `FAREMETER_HANDLERS_MODULE ${specifier} did not produce a module object`,
    );
  }

  // Accept either a default export or named exports.
  const source = isPlainObject(imported.default) ? imported.default : imported;
  const { bindings, mppBindings } = source;

  if (!Array.isArray(bindings)) {
    throw new Error(
      `FAREMETER_HANDLERS_MODULE ${specifier} must export "bindings" as an array`,
    );
  }
  if (mppBindings !== undefined && !Array.isArray(mppBindings)) {
    throw new Error(
      `FAREMETER_HANDLERS_MODULE ${specifier} "mppBindings" must be an array when present`,
    );
  }

  // The binding shape carries handler instances with closures over RPC
  // clients, signing keys, etc. Validating those structurally is not
  // tractable; the operator-supplied module is trusted to produce well-
  // formed bindings. Misshapen bindings will surface at dispatch time
  // with the R4 ("misconfiguration surfaces") guards in the gateway.
  const result: HandlersModule = { bindings: bindings as HandlerBinding[] };
  if (mppBindings !== undefined) {
    result.mppBindings = mppBindings as MPPBinding[];
  }
  return result;
}

async function main() {
  const specPath = process.argv[2] ?? process.env.FAREMETER_SPEC;
  if (!specPath) {
    logger.fatal("usage: sidecar <spec-path> (or set FAREMETER_SPEC)");
    process.exit(1);
  }

  const baseURL = process.env.FAREMETER_BASE_URL;
  if (!baseURL) {
    logger.fatal(
      "FAREMETER_BASE_URL is required; it is the public URL of the " +
        "gateway in front of the upstream service and is used verbatim as " +
        "the x402 'resource' field",
    );
    process.exit(1);
  }

  const handlersModulePath = process.env.FAREMETER_HANDLERS_MODULE;
  if (!handlersModulePath) {
    logger.fatal(
      "FAREMETER_HANDLERS_MODULE is required; it must point at a JS " +
        "module exporting { bindings: HandlerBinding[], mppBindings?: " +
        "MPPBinding[] }. The generic sidecar binary cannot construct " +
        "handlers on its own because handler instances are scheme- " +
        "specific (e.g. Solana facilitator, EVM facilitator). A " +
        "client-side facilitator-over-HTTP handler that would let the " +
        "binary be configured by URL alone does not yet exist; until " +
        "then the operator must supply bindings via this module.",
    );
    process.exit(1);
  }

  const { bindings, mppBindings } =
    await loadHandlersModule(handlersModulePath);
  const { spec } = await loadSpec(specPath);
  const port = parsePort(process.env.PORT);
  const { app } = createApp({
    spec,
    baseURL,
    bindings,
    ...(mppBindings ? { mppBindings } : {}),
  });

  logger.info("starting sidecar", {
    port,
    specPath,
    baseURL,
    handlersModulePath,
    bindingCount: bindings.length,
    mppBindingCount: mppBindings?.length ?? 0,
  });
  serve({ fetch: app.fetch, port });
}

main().catch((cause: unknown) => {
  logger.fatal("failed to start sidecar", {
    message: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
  });
  process.exit(1);
});
