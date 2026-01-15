import { ConsoleBackend } from "./console";
import type { Logger, LoggingBackend, LogLevel } from "./types";

export { ConsoleBackend } from "./console";
export {
  type Logger,
  type LoggingBackend,
  type LogLevel,
  type LogArgs,
  type Context,
  LogLevels,
} from "./types";

export interface ConfigureAppArgs {
  level?: LogLevel;
  backend?: LoggingBackend;
}

let activeBackend: LoggingBackend | null = null;

async function resolveBackend() {
  try {
    const { LogtapeBackend } = await import("./logtape");
    return LogtapeBackend;
  } catch {
    return ConsoleBackend;
  }
}

export async function configureApp(args: ConfigureAppArgs = {}) {
  activeBackend = args.backend ?? (await resolveBackend());
  await activeBackend.configureApp({ level: args.level ?? "info" });
}

export async function getLogger(subsystem: readonly string[]): Promise<Logger> {
  activeBackend ??= await resolveBackend();

  let cachedBackend = activeBackend;
  let cachedLogger = cachedBackend.getLogger(subsystem);

  function getLogger() {
    if (activeBackend && cachedBackend !== activeBackend) {
      cachedBackend = activeBackend;
      cachedLogger = cachedBackend.getLogger(subsystem);
    }
    return cachedLogger;
  }

  return {
    debug(...args) {
      getLogger().debug(...args);
    },
    info(...args) {
      getLogger().info(...args);
    },
    warning(...args) {
      getLogger().warning(...args);
    },
    error(...args) {
      getLogger().error(...args);
    },
    fatal(...args) {
      getLogger().fatal(...args);
    },
  };
}
