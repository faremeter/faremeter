/* eslint-disable no-console */
import type { LogArgs, LoggingBackend, LogLevel } from "./types";
import { shouldLog } from "./types";

function convertArgs([msg, context]: LogArgs) {
  if (context !== undefined) {
    return [msg, context];
  } else {
    return [msg];
  }
}

let configuredLevel: LogLevel = "info";

export const ConsoleBackend: LoggingBackend = {
  async configureApp(args: { level: LogLevel }) {
    configuredLevel = args.level;
  },

  getLogger(_subsystem: readonly string[]) {
    return {
      debug: (...args) => {
        if (shouldLog("debug", configuredLevel))
          console.debug(...convertArgs(args));
      },
      info: (...args) => {
        if (shouldLog("info", configuredLevel))
          console.info(...convertArgs(args));
      },
      warning: (...args) => {
        if (shouldLog("warning", configuredLevel))
          console.warn(...convertArgs(args));
      },
      error: (...args) => {
        if (shouldLog("error", configuredLevel))
          console.error(...convertArgs(args));
      },
      fatal: (...args) => {
        if (shouldLog("fatal", configuredLevel))
          console.error(...convertArgs(args));
      },
    };
  },
};
