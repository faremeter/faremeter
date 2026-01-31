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

/**
 * Configuration options for initializing the logging system.
 */
export interface ConfigureAppArgs {
  /** Minimum log level to emit. Defaults to `"info"`. */
  level?: LogLevel;
  /** Backend implementation to use. Auto-detected if not provided. */
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

/**
 * Initializes the global logging system.
 *
 * Call this once at application startup to configure the log level and backend.
 * If no backend is specified, logtape is used when available, otherwise falls
 * back to console output.
 *
 * @param args - Configuration options for level and backend.
 *
 * @example
 * ```typescript
 * await configureApp({ level: "debug" });
 * ```
 */
export async function configureApp(args: ConfigureAppArgs = {}) {
  activeBackend = args.backend ?? (await resolveBackend());
  await activeBackend.configureApp({ level: args.level ?? "info" });
}

/**
 * Creates a logger for a specific subsystem.
 *
 * The returned logger automatically adapts if the backend changes after
 * creation (e.g., when {@link configureApp} is called later).
 *
 * @param subsystem - Hierarchical category path for the logger.
 * @returns A logger instance scoped to the subsystem.
 *
 * @example
 * ```typescript
 * const logger = await getLogger(["faremeter", "client"]);
 * logger.info("Client initialized", { version: "1.0.0" });
 * ```
 */
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
