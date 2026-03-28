# @faremeter/logs

A configurable logging abstraction with pluggable backends.

## Installation

```bash
pnpm install @faremeter/logs
```

## Features

- Unified logging interface across all packages
- Pluggable backends (console, logtape)
- Hierarchical logger naming
- Runtime backend swapping

## API Reference

<!-- TSDOC_START -->

## Functions

- [shouldLog](#shouldlog)
- [ConsoleBackend.debug](#consolebackend.debug)
- [configureApp](#configureapp)
- [getLogger](#getlogger)

### shouldLog

| Function    | Type                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shouldLog` | `(level: "trace" or "debug" or "info" or "warning" or "error" or "fatal", configuredLevel: "trace" or "debug" or "info" or "warning" or "error" or "fatal") => boolean` |

### ConsoleBackend.debug

| Function               | Type                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `ConsoleBackend.debug` | `(message: string, context?: Context or undefined) => void` |

### configureApp

Initializes the global logging system.

Call this once at application startup to configure the log level and backend.
If no backend is specified, logtape is used when available, otherwise falls
back to console output.

| Function       | Type                                         |
| -------------- | -------------------------------------------- |
| `configureApp` | `(args?: ConfigureAppArgs) => Promise<void>` |

Parameters:

- `args`: - Configuration options for level and backend.

Examples:

```typescript
await configureApp({ level: "debug" });
```

### getLogger

Creates a logger for a specific subsystem.

The returned logger automatically adapts if the backend changes after
creation (e.g., when {@link configureApp} is called later).

| Function    | Type                                                |
| ----------- | --------------------------------------------------- |
| `getLogger` | `(subsystem: readonly string[]) => Promise<Logger>` |

Parameters:

- `subsystem`: - Hierarchical category path for the logger.

Returns:

A logger instance scoped to the subsystem.

Examples:

```typescript
const logger = await getLogger(["faremeter", "client"]);
logger.info("Client initialized", { version: "1.0.0" });
```

## Constants

- [LogLevels](#loglevels)

### LogLevels

| Constant    | Type                                                               |
| ----------- | ------------------------------------------------------------------ |
| `LogLevels` | `readonly ["trace", "debug", "info", "warning", "error", "fatal"]` |

## Interfaces

- [Logger](#logger)
- [LoggingBackend](#loggingbackend)
- [ConfigureAppArgs](#configureappargs)

### Logger

| Property | Type | Description |
| -------- | ---- | ----------- |

### LoggingBackend

Backend implementation for the logging system.

Backends handle log output destinations (console, file, external service)
and can be swapped at runtime via {@link configureApp}.

| Property | Type | Description |
| -------- | ---- | ----------- |

### ConfigureAppArgs

Configuration options for initializing the logging system.

| Property  | Type                                                                           | Description                                                   |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `level`   | `"trace" or "debug" or "info" or "warning" or "error" or "fatal" or undefined` | Minimum log level to emit. Defaults to `"info"`.              |
| `backend` | `LoggingBackend<BaseConfigArgs> or undefined`                                  | Backend implementation to use. Auto-detected if not provided. |

## Types

- [LogLevel](#loglevel)
- [Context](#context)
- [LogArgs](#logargs)
- [BaseConfigArgs](#baseconfigargs)

### LogLevel

| Type       | Type                         |
| ---------- | ---------------------------- |
| `LogLevel` | `(typeof LogLevels)[number]` |

### Context

| Type      | Type                      |
| --------- | ------------------------- |
| `Context` | `Record<string, unknown>` |

### LogArgs

| Type      | Type                                   |
| --------- | -------------------------------------- |
| `LogArgs` | `[message: string, context?: Context]` |

### BaseConfigArgs

| Type             | Type                  |
| ---------------- | --------------------- |
| `BaseConfigArgs` | `{ level: LogLevel }` |

<!-- TSDOC_END -->

## Related Packages

- [@faremeter/middleware](https://www.npmjs.com/package/@faremeter/middleware) - Server middleware
- [@faremeter/facilitator](https://www.npmjs.com/package/@faremeter/facilitator) - Facilitator server

## License

LGPL-3.0-only
