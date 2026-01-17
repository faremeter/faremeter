# AGENTS.md

Instructions for AI agents working in this repository.

## x402 Payment Protocol

For all x402-related operations, use local `@faremeter` packages unless explicitly instructed otherwise.
**Do not use experimental x402 payment schemes unless explicitly told to do so.**

## Additional Conventions

See `CONVENTIONS.md` for complete development conventions including:

- Package management with pnpm catalog
- TypeScript configuration
- Code style and linting
- Build verification (`make` before completing tasks)

## Build Requirements

**CRITICAL:** You MUST build the entire tree with `make` before declaring any task complete.

When making changes to packages (especially in `packages/`):

1. Individual package builds do NOT guarantee the full tree will build
2. Type exports and imports may not be available until the full tree is built
3. Tests may fail if dependent packages are not rebuilt
4. ALWAYS run `make` at the root to verify the entire monorepo builds

**Never claim a task is complete without running a successful `make` build.**

## Code Reuse and Refactoring

Do not reimplement functionality that already exists in the codebase. Before writing new code:

1. Search for existing implementations that could serve the same purpose
2. If similar functionality exists, prefer refactoring it to meet the new requirements
3. Look for unexported functions in other packages that could be promoted to a shared location for broader use

When you detect that a refactor might be necessary, prompt the user with a question asking which approach to take. Offer specific options such as:

- Refactor the existing implementation
- Promote an unexported function to a shared package (ask the user which package)
- Create a new implementation

Allow the user to provide their own answer if none of the options fit.

## Personality

Do not use emojis in code or documentation, or attempt to be cute with your aesthetic. Act like a professional.

## Configuration

Do not modify configuration files (e.g. eslint, prettier) unless explicitly asked to. Your job is to write working software not change the conventions that are being used.
