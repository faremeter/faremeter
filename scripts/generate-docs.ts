#!/usr/bin/env pnpm tsx

/**
 * Generates API documentation for all packages in the docs/ directory.
 *
 * Uses tsdoc-markdown with explore mode to traverse the TypeScript tree
 * from each package's entry point and generate comprehensive markdown
 * documentation including functions, classes, types, and interfaces.
 */

import { generateDocumentation } from "tsdoc-markdown";
import { readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { logger } from "./logger";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT_DIR, "packages");
const DOCS_DIR = join(ROOT_DIR, "docs");

function getPackageDirectories(): string[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

if (existsSync(DOCS_DIR)) {
  rmSync(DOCS_DIR, { recursive: true });
}
mkdirSync(DOCS_DIR, { recursive: true });

const packages = getPackageDirectories();
logger.info(`Found ${packages.length} packages to document`);

for (const packageName of packages) {
  const inputFile = join(PACKAGES_DIR, packageName, "src", "index.ts");

  if (!existsSync(inputFile)) {
    logger.warning(`Skipping ${packageName}: no src/index.ts found`);
    continue;
  }

  const outputDir = join(DOCS_DIR, packageName);
  mkdirSync(outputDir, { recursive: true });

  const outputFile = join(outputDir, "README.md");

  logger.info(`Generating docs for @faremeter/${packageName}`);

  generateDocumentation({
    inputFiles: [inputFile],
    outputFile,
    buildOptions: {
      explore: true,
      types: true,
      repo: {
        url: "https://github.com/faremeter/faremeter",
        branch: "main",
      },
    },
    markdownOptions: {
      emoji: null,
      headingLevel: "##",
    },
  });
}

logger.info(`Documentation generated in ${DOCS_DIR}`);
