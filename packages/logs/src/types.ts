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
