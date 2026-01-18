import * as logtape from "@logtape/logtape";
import type { Sink } from "@logtape/logtape";
import type { LogArgs, LoggingBackend, LogLevel, Context } from "./types";

function convertArgs([msg, context]: LogArgs): [string, Context?] {
  if (context !== undefined) {
    if (Object.keys(context).length > 0) {
      msg += ": {*}";
    }

    return [msg, context];
  }

  return [msg];
}

export const LogtapeBackend: LoggingBackend<{
  level: LogLevel;
  sink?: Sink;
}> = {
  async configureApp(args: { level: LogLevel; sink?: Sink }) {
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
  },
};
