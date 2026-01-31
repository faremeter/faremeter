export const LogLevels = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;

export type LogLevel = (typeof LogLevels)[number];

export function shouldLog(level: LogLevel, configuredLevel: LogLevel) {
  return LogLevels.indexOf(level) >= LogLevels.indexOf(configuredLevel);
}

export type Context = Record<string, unknown>;
export type LogArgs = [message: string, context?: Context];

export interface Logger {
  debug(...args: LogArgs): void;
  info(...args: LogArgs): void;
  warning(...args: LogArgs): void;
  error(...args: LogArgs): void;
  fatal(...args: LogArgs): void;
}

export type BaseConfigArgs = { level: LogLevel };

/**
 * Backend implementation for the logging system.
 *
 * Backends handle log output destinations (console, file, external service)
 * and can be swapped at runtime via {@link configureApp}.
 *
 * @typeParam TConfig - Configuration options for this backend.
 */
export interface LoggingBackend<
  TConfig extends BaseConfigArgs = BaseConfigArgs,
> {
  /**
   * Initializes the backend with the given configuration.
   *
   * @param args - Backend-specific configuration including minimum log level.
   */
  configureApp(args: TConfig): Promise<void>;

  /**
   * Creates a logger scoped to a subsystem hierarchy.
   *
   * @param subsystem - Hierarchical category for the logger (e.g., `["faremeter", "client"]`).
   * @returns A logger instance for the specified subsystem.
   */
  getLogger(subsystem: readonly string[]): Logger;
}
