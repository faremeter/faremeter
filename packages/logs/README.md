## Functions

- [configureApp](#configureapp)
- [getLogger](#getlogger)

### configureApp

| Function       | Type                                         |
| -------------- | -------------------------------------------- |
| `configureApp` | `(args?: ConfigureAppArgs) => Promise<void>` |

### getLogger

| Function    | Type                                                |
| ----------- | --------------------------------------------------- |
| `getLogger` | `(subsystem: readonly string[]) => Promise<Logger>` |

## Interfaces

- [ConfigureAppArgs](#configureappargs)

### ConfigureAppArgs

| Property  | Type                                                                           | Description |
| --------- | ------------------------------------------------------------------------------ | ----------- |
| `level`   | `"trace" or "debug" or "info" or "warning" or "error" or "fatal" or undefined` |             |
| `backend` | `LoggingBackend or undefined`                                                  |             |
