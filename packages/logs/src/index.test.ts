#!/usr/bin/env pnpm tsx
/* eslint-disable no-console */

import t from "tap";
import { ConsoleBackend } from "./console";
import { LogtapeBackend } from "./logtape";
import { configureApp, getLogger } from "./index";
import type { LogArgs, Logger, LoggingBackend, LogLevel } from "./types";
import { shouldLog, LogLevels } from "./types";

await t.test("getLogger without configureApp", async (t) => {
  const logger = await getLogger(["faremeter", "auto", "test"]);

  t.equal(typeof logger.debug, "function");
  t.equal(typeof logger.info, "function");
  t.equal(typeof logger.warning, "function");
  t.equal(typeof logger.error, "function");
  t.equal(typeof logger.fatal, "function");

  logger.info("auto-resolved backend test");

  t.pass("getLogger works without explicit configureApp");
  t.end();
});

function createConsoleSpy() {
  const calls: { method: string; args: unknown[] }[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const spy = {
    install() {
      console.debug = (...args: unknown[]) =>
        calls.push({ method: "debug", args });
      console.info = (...args: unknown[]) =>
        calls.push({ method: "info", args });
      console.warn = (...args: unknown[]) =>
        calls.push({ method: "warn", args });
      console.error = (...args: unknown[]) =>
        calls.push({ method: "error", args });
    },
    restore() {
      console.debug = original.debug;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
    getCalls() {
      return calls;
    },
    clear() {
      calls.length = 0;
    },
  };

  return spy;
}

await t.test("shouldLog utility", async (t) => {
  t.equal(shouldLog("fatal", "debug"), true, "fatal should log at debug level");
  t.equal(shouldLog("error", "debug"), true, "error should log at debug level");
  t.equal(
    shouldLog("warning", "debug"),
    true,
    "warning should log at debug level",
  );
  t.equal(shouldLog("info", "debug"), true, "info should log at debug level");
  t.equal(shouldLog("debug", "debug"), true, "debug should log at debug level");

  t.equal(
    shouldLog("debug", "info"),
    false,
    "debug should not log at info level",
  );
  t.equal(
    shouldLog("info", "warning"),
    false,
    "info should not log at warning level",
  );
  t.equal(
    shouldLog("warning", "error"),
    false,
    "warning should not log at error level",
  );
  t.equal(
    shouldLog("error", "fatal"),
    false,
    "error should not log at fatal level",
  );

  t.equal(shouldLog("info", "info"), true, "info should log at info level");
  t.equal(shouldLog("error", "error"), true, "error should log at error level");

  t.end();
});

await t.test("ConsoleBackend", async (t) => {
  const spy = createConsoleSpy();

  await t.test("logs at configured level", async (t) => {
    spy.install();
    t.teardown(() => spy.restore());

    await ConsoleBackend.configureApp({ level: "info" });
    const logger = ConsoleBackend.getLogger(["faremeter", "test"]);

    spy.clear();
    logger.debug("debug message");
    t.equal(spy.getCalls().length, 0, "debug should not log at info level");

    spy.clear();
    logger.info("info message");
    t.equal(spy.getCalls().length, 1, "info should log at info level");
    t.equal(spy.getCalls().at(0)?.method, "info");
    t.equal(spy.getCalls().at(0)?.args[0], "info message");

    spy.clear();
    logger.warning("warning message");
    t.equal(spy.getCalls().length, 1, "warning should log at info level");
    t.equal(spy.getCalls().at(0)?.method, "warn");

    spy.clear();
    logger.error("error message");
    t.equal(spy.getCalls().length, 1, "error should log at info level");
    t.equal(spy.getCalls().at(0)?.method, "error");

    spy.clear();
    logger.fatal("fatal message");
    t.equal(spy.getCalls().length, 1, "fatal should log at info level");
    t.equal(spy.getCalls().at(0)?.method, "error");

    t.end();
  });

  await t.test("logs with context", async (t) => {
    spy.install();
    t.teardown(() => spy.restore());

    await ConsoleBackend.configureApp({ level: "debug" });
    const logger = ConsoleBackend.getLogger(["faremeter", "test"]);

    spy.clear();
    logger.info("message with context", { key: "value", num: 42 });
    t.equal(spy.getCalls().length, 1);
    t.equal(spy.getCalls().at(0)?.args[0], "message with context");
    t.same(spy.getCalls().at(0)?.args[1], { key: "value", num: 42 });

    t.end();
  });

  await t.test("respects debug level configuration", async (t) => {
    spy.install();
    t.teardown(() => spy.restore());

    await ConsoleBackend.configureApp({ level: "debug" });
    const logger = ConsoleBackend.getLogger(["faremeter", "test"]);

    spy.clear();
    logger.debug("debug message");
    t.equal(spy.getCalls().length, 1, "debug should log at debug level");
    t.equal(spy.getCalls().at(0)?.method, "debug");

    t.end();
  });

  await t.test("respects error level configuration", async (t) => {
    spy.install();
    t.teardown(() => spy.restore());

    await ConsoleBackend.configureApp({ level: "error" });
    const logger = ConsoleBackend.getLogger(["faremeter", "test"]);

    spy.clear();
    logger.debug("debug message");
    logger.info("info message");
    logger.warning("warning message");
    t.equal(
      spy.getCalls().length,
      0,
      "lower levels should not log at error level",
    );

    logger.error("error message");
    t.equal(spy.getCalls().length, 1, "error should log at error level");

    spy.clear();
    logger.fatal("fatal message");
    t.equal(spy.getCalls().length, 1, "fatal should log at error level");

    t.end();
  });

  t.end();
});

// LogtapeBackend can only be configured once per process without the reset flag.
await t.test("LogtapeBackend", async (t) => {
  await LogtapeBackend.configureApp({ level: "debug" });

  await t.test("has correct logger interface", async (t) => {
    const logger = LogtapeBackend.getLogger(["faremeter", "test"]);

    t.equal(typeof logger.debug, "function");
    t.equal(typeof logger.info, "function");
    t.equal(typeof logger.warning, "function");
    t.equal(typeof logger.error, "function");
    t.equal(typeof logger.fatal, "function");

    t.end();
  });

  await t.test("can log messages without throwing", async (t) => {
    const logger = LogtapeBackend.getLogger(["faremeter", "test", "logtape"]);

    logger.debug("debug from logtape test");
    logger.info("info from logtape test");
    logger.warning("warning from logtape test");
    logger.error("error from logtape test");
    logger.fatal("fatal from logtape test");

    t.pass("all log methods executed without error");
    t.end();
  });

  await t.test("can log with context without throwing", async (t) => {
    const logger = LogtapeBackend.getLogger(["faremeter", "test", "context"]);

    logger.info("message with context", { key: "value", num: 42 });
    logger.error("error with context", { error: "something went wrong" });

    t.pass("context logging executed without error");
    t.end();
  });

  await t.test("different subsystems get separate loggers", async (t) => {
    const logger1 = LogtapeBackend.getLogger(["faremeter", "module1"]);
    const logger2 = LogtapeBackend.getLogger(["faremeter", "module2"]);

    logger1.info("from module1");
    logger2.info("from module2");

    t.pass("multiple subsystem loggers work");
    t.end();
  });

  t.end();
});

await t.test("backend switching", async (t) => {
  const spy = createConsoleSpy();

  await t.test(
    "existing loggers update when backend is switched",
    async (t) => {
      spy.install();
      t.teardown(() => spy.restore());

      await configureApp({ level: "info", backend: ConsoleBackend });
      const logger = await getLogger(["faremeter", "test", "switch1"]);

      spy.clear();
      logger.info("message via console");
      t.equal(spy.getCalls().length, 1, "should log via console");
      t.equal(spy.getCalls().at(0)?.args[0], "message via console");

      const customCalls: string[] = [];
      const CustomBackend: LoggingBackend = {
        configureApp: () => Promise.resolve(),
        getLogger() {
          return {
            debug: (msg: string) => customCalls.push(`debug: ${msg}`),
            info: (msg: string) => customCalls.push(`info: ${msg}`),
            warning: (msg: string) => customCalls.push(`warning: ${msg}`),
            error: (msg: string) => customCalls.push(`error: ${msg}`),
            fatal: (msg: string) => customCalls.push(`fatal: ${msg}`),
          };
        },
      };

      await configureApp({ level: "info", backend: CustomBackend });

      spy.clear();
      customCalls.length = 0;
      logger.info("message after switch");

      t.equal(
        spy.getCalls().length,
        0,
        "console should not receive the message",
      );
      t.equal(
        customCalls.length,
        1,
        "custom backend should receive the message",
      );
      t.equal(customCalls[0], "info: message after switch");

      t.end();
    },
  );

  await t.test("can switch back to ConsoleBackend", async (t) => {
    const customCalls: string[] = [];
    const CustomBackend: LoggingBackend = {
      configureApp: () => Promise.resolve(),
      getLogger() {
        return {
          debug: (msg: string) => customCalls.push(`debug: ${msg}`),
          info: (msg: string) => customCalls.push(`info: ${msg}`),
          warning: (msg: string) => customCalls.push(`warning: ${msg}`),
          error: (msg: string) => customCalls.push(`error: ${msg}`),
          fatal: (msg: string) => customCalls.push(`fatal: ${msg}`),
        };
      },
    };

    await configureApp({ level: "info", backend: CustomBackend });
    const logger = await getLogger(["faremeter", "test", "switch2"]);

    customCalls.length = 0;
    logger.info("via custom");
    t.equal(customCalls.length, 1, "should log to custom backend");

    spy.install();
    t.teardown(() => spy.restore());

    await configureApp({ level: "info", backend: ConsoleBackend });

    spy.clear();
    customCalls.length = 0;
    logger.info("via console after switch");

    t.equal(customCalls.length, 0, "custom backend should not receive message");
    t.equal(spy.getCalls().length, 1, "console should receive message");
    t.equal(spy.getCalls().at(0)?.args[0], "via console after switch");

    t.end();
  });

  await t.test("new loggers use the current backend", async (t) => {
    spy.install();
    t.teardown(() => spy.restore());

    await configureApp({ level: "debug", backend: ConsoleBackend });

    const logger1 = await getLogger(["faremeter", "test", "new1"]);
    spy.clear();
    logger1.debug("from logger1");
    t.equal(spy.getCalls().length, 1, "logger1 should use ConsoleBackend");

    const customCalls: string[] = [];
    const CustomBackend: LoggingBackend = {
      configureApp: () => Promise.resolve(),
      getLogger() {
        return {
          debug: (msg: string) => customCalls.push(`debug: ${msg}`),
          info: (msg: string) => customCalls.push(`info: ${msg}`),
          warning: (msg: string) => customCalls.push(`warning: ${msg}`),
          error: (msg: string) => customCalls.push(`error: ${msg}`),
          fatal: (msg: string) => customCalls.push(`fatal: ${msg}`),
        };
      },
    };

    await configureApp({ level: "debug", backend: CustomBackend });

    const logger2 = await getLogger(["faremeter", "test", "new2"]);
    customCalls.length = 0;
    logger2.debug("from logger2");
    t.equal(customCalls.length, 1, "logger2 should use custom backend");

    customCalls.length = 0;
    logger1.debug("from logger1 after switch");
    t.equal(customCalls.length, 1, "logger1 should also use custom backend");

    t.end();
  });

  t.end();
});

await t.test("log level configuration", async (t) => {
  const spy = createConsoleSpy();
  spy.install();
  t.teardown(() => spy.restore());

  for (const level of LogLevels) {
    await t.test(`level: ${level}`, async (t) => {
      await configureApp({ level, backend: ConsoleBackend });
      const logger = await getLogger(["faremeter", "test", "levels", level]);

      spy.clear();

      logger.debug("debug");
      logger.info("info");
      logger.warning("warning");
      logger.error("error");
      logger.fatal("fatal");

      // Expected count based on level: trace/debug=5, info=4, warning=3, error=2, fatal=1
      const adjustedExpected =
        level === "trace"
          ? 5
          : level === "debug"
            ? 5
            : level === "info"
              ? 4
              : level === "warning"
                ? 3
                : level === "error"
                  ? 2
                  : 1;

      t.equal(
        spy.getCalls().length,
        adjustedExpected,
        `at ${level} level, ${adjustedExpected} messages should be logged`,
      );

      t.end();
    });
  }

  t.end();
});

await t.test("custom backend", async (t) => {
  const loggedMessages: {
    level: string;
    subsystem: string[];
    args: LogArgs;
  }[] = [];

  const CustomBackend: LoggingBackend = {
    configureApp: (_args: { level: LogLevel }) => Promise.resolve(),

    getLogger(subsystem: readonly string[]): Logger {
      return {
        debug(...args: LogArgs) {
          loggedMessages.push({
            level: "debug",
            subsystem: [...subsystem],
            args,
          });
        },
        info(...args: LogArgs) {
          loggedMessages.push({
            level: "info",
            subsystem: [...subsystem],
            args,
          });
        },
        warning(...args: LogArgs) {
          loggedMessages.push({
            level: "warning",
            subsystem: [...subsystem],
            args,
          });
        },
        error(...args: LogArgs) {
          loggedMessages.push({
            level: "error",
            subsystem: [...subsystem],
            args,
          });
        },
        fatal(...args: LogArgs) {
          loggedMessages.push({
            level: "fatal",
            subsystem: [...subsystem],
            args,
          });
        },
      };
    },
  };

  await configureApp({ level: "debug", backend: CustomBackend });
  const logger = await getLogger(["faremeter", "custom", "test"]);

  loggedMessages.length = 0;

  logger.info("test message", { key: "value" });
  logger.error("error message");

  t.equal(loggedMessages.length, 2, "should have logged 2 messages");
  t.equal(loggedMessages.at(0)?.level, "info");
  t.same(loggedMessages.at(0)?.subsystem, ["faremeter", "custom", "test"]);
  t.equal(loggedMessages.at(0)?.args[0], "test message");
  t.same(loggedMessages.at(0)?.args[1], { key: "value" });

  t.equal(loggedMessages.at(1)?.level, "error");
  t.equal(loggedMessages.at(1)?.args[0], "error message");
  t.equal(loggedMessages.at(1)?.args[1], undefined);

  t.end();
});

await t.test("multiple loggers", async (t) => {
  const spy = createConsoleSpy();
  spy.install();
  t.teardown(() => spy.restore());

  await configureApp({ level: "info", backend: ConsoleBackend });

  const logger1 = await getLogger(["faremeter", "module1"]);
  const logger2 = await getLogger(["faremeter", "module2"]);
  const logger3 = await getLogger(["faremeter", "module1", "submodule"]);

  spy.clear();

  logger1.info("from module1");
  logger2.info("from module2");
  logger3.info("from submodule");

  t.equal(spy.getCalls().length, 3, "all three loggers should log");
  t.equal(spy.getCalls().at(0)?.args[0], "from module1");
  t.equal(spy.getCalls().at(1)?.args[0], "from module2");
  t.equal(spy.getCalls().at(2)?.args[0], "from submodule");

  t.end();
});
