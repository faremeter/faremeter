/**
 * Ordered list of log levels from least to most severe.
 *
 * Used for level comparison when filtering log output.
 */
export const LogLevels = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;

/**
 * Valid log severity levels.
 */
export type LogLevel = (typeof LogLevels)[number];

export function shouldLog(level: LogLevel, configuredLevel: LogLevel) {
  return LogLevels.indexOf(level) >= LogLevels.indexOf(configuredLevel);
}

/**
 * Structured context data attached to log messages.
 */
export type Context = Record<string, unknown>;

/**
 * Arguments passed to logger methods: a message string and optional context.
 */
export type LogArgs = [message: string, context?: Context];

/**
 * Logger interface for emitting structured log messages at various severity levels.
 *
 * Each method accepts a message string and optional context object.
 */
export interface Logger {
  /** Logs a debug-level message for detailed troubleshooting. */
  debug(...args: LogArgs): void;
  /** Logs an informational message about normal operation. */
  info(...args: LogArgs): void;
  /** Logs a warning about a potential issue that is not yet an error. */
  warning(...args: LogArgs): void;
  /** Logs an error that occurred during operation. */
  error(...args: LogArgs): void;
  /** Logs a fatal error indicating the application cannot continue. */
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
