import { configure, getConsoleSink, getLogger } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
    { category: "faremeter", lowestLevel: "debug", sinks: ["console"] },
  ],
});

export const logger = getLogger(["faremeter", "scripts"]);
