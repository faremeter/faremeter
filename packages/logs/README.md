## Functions

- [configureApp](#configureapp)
- [getLogger](#getlogger)

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

## Interfaces

- [ConfigureAppArgs](#configureappargs)

### ConfigureAppArgs

Configuration options for initializing the logging system.

| Property  | Type                                                                           | Description                                                   |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `level`   | `"trace" or "debug" or "info" or "warning" or "error" or "fatal" or undefined` | Minimum log level to emit. Defaults to `"info"`.              |
| `backend` | `LoggingBackend<BaseConfigArgs> or undefined`                                  | Backend implementation to use. Auto-detected if not provided. |
