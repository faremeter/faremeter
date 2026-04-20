import type { Sink } from "@logtape/logtape";
import type { LogArgs, LoggingBackend, LogLevel, Context } from "./types";

type LogtapeModule = typeof import("@logtape/logtape");
let logtapeCache: LogtapeModule | null = null;

async function loadLogtape(): Promise<LogtapeModule> {
  if (logtapeCache) return logtapeCache;
  // Variable specifier keeps this import opaque to bundlers like esbuild and
  // wrangler. Consumers that do not install @logtape/logtape (e.g. a
  // Cloudflare Workers app using ConsoleBackend only) can still bundle
  // @faremeter/logs without a build-time "Could not resolve" error. On any
  // runtime without the module available, the import rejects at runtime and
  // the caller is expected to fall back (see resolveBackend in index.ts).
  const spec = ["@logtape", "logtape"].join("/");
  const mod = (await import(spec)) as LogtapeModule;
  logtapeCache = mod;
  return mod;
}

export async function isLogtapeAvailable(): Promise<boolean> {
  try {
    await loadLogtape();
    return true;
  } catch {
    return false;
  }
}

function convertArgs([msg, context]: LogArgs): [string, Context?] {
  if (context !== undefined) {
    if (Object.keys(context).length > 0) {
      msg += ": {*}";
    }

    return [msg, context];
  }

  return [msg];
}

/**
 * Logging backend powered by the logtape library.
 *
 * Provides structured logging with configurable sinks. When available,
 * this backend is preferred over {@link ConsoleBackend} for its richer
 * formatting and sink flexibility.
 *
 * The @logtape/logtape module is loaded lazily via a bundler-opaque dynamic
 * import. Consumers that never use LogtapeBackend do not need the module
 * installed and can bundle for environments like Cloudflare Workers cleanly.
 */
export const LogtapeBackend: LoggingBackend<{
  level: LogLevel;
  sink?: Sink;
}> = {
  async configureApp(args: { level: LogLevel; sink?: Sink }) {
    const logtape = await loadLogtape();
    const lowestLevel = args.level;

    await logtape.configure({
      sinks: { console: args.sink ?? logtape.getConsoleSink() },
      loggers: [
        {
          category: ["logtape", "meta"],
          lowestLevel: "warning",
          sinks: ["console"],
        },
        { category: "faremeter", lowestLevel, sinks: ["console"] },
      ],
    });
  },

  getLogger(subsystem: readonly string[]) {
    if (!logtapeCache) {
      throw new Error(
        "LogtapeBackend.getLogger called before configureApp. " +
          "Call await LogtapeBackend.configureApp() first, " +
          "or install @logtape/logtape alongside @faremeter/logs.",
      );
    }
    const impl = logtapeCache.getLogger(subsystem);

    return {
      debug: (...args) => {
        impl.debug(...convertArgs(args));
      },
      info: (...args) => {
        impl.info(...convertArgs(args));
      },
      warning: (...args) => {
        impl.warning(...convertArgs(args));
      },
      error: (...args) => {
        impl.error(...convertArgs(args));
      },
      fatal: (...args) => {
        impl.fatal(...convertArgs(args));
      },
    };
  },
};
