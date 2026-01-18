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

// Core logging function
export interface Logger {
  debug(...args: LogArgs): void;
  info(...args: LogArgs): void;
  warning(...args: LogArgs): void;
  error(...args: LogArgs): void;
  fatal(...args: LogArgs): void;
}

export type BaseConfigArgs = { level: LogLevel };

export interface LoggingBackend<
  TConfig extends BaseConfigArgs = BaseConfigArgs,
> {
  configureApp(args: TConfig): Promise<void>;
  getLogger(subsystem: readonly string[]): Logger;
}
