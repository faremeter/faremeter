import * as logtape from "@logtape/logtape";
import type { Logger, LogArgs, Context } from "./types";

function convertArgs([msg, context]: LogArgs): [string, Context?] {
  if (context !== undefined) {
    if (Object.keys(context).length > 0) {
      msg += ": {*}";
    }

    return [msg, context];
  }

  return [msg];
}

export interface ConfigureAppArgs {
  level?: logtape.LogLevel;
}

export async function configureApp(args: ConfigureAppArgs = {}) {
  const lowestLevel = args.level ?? "info";

  await logtape.configure({
    sinks: { console: logtape.getConsoleSink() },
    loggers: [
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
      { category: "faremeter", lowestLevel, sinks: ["console"] },
    ],
  });
}

export async function getLogger(subsystem: readonly string[]): Promise<Logger> {
  const impl = logtape.getLogger(subsystem);

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
}
