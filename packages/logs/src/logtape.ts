import * as logtape from "@logtape/logtape";

export interface ConfigureAppArgs {
  level?: logtape.LogLevel;
}

export async function configureApp(args: ConfigureAppArgs = {}) {
  const lowestLevel = args.level ?? "info";

  await logtape.configure({
    sinks: { console: logtape.getConsoleSink() },
    loggers: [
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
      { category: "faremeter", lowestLevel, sinks: ["console"] },
    ],
  });
}

export async function getLogger(subsystem: readonly string[]) {
  const logger = logtape.getLogger(subsystem);

  return logger;
}
