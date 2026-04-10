# AGENTS.md

Instructions for AI agents working in this repository.

## Session Initialization

At the start of every session, before doing any other work:

1. Read `CONVENTIONS.md` and follow all conventions defined there
2. Glob for all `SKILL.md` files under `skills/` and load each one
3. Read `DEV.md` for development environment setup instructions

Do not proceed with any user requests until all steps are complete.

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

If `make` fails, you must report the failure to the user and identify the cause.
Do not work around a failing `make` by running individual targets (e.g.
`make build`, `make test`) and treating their success as equivalent. A full
`make` is the only acceptable verification. If the failure is pre-existing and
unrelated to your changes, say so explicitly and let the user decide how to
proceed. Never silently skip a failing step or substitute a partial build.

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

## Running Integration Examples

The Solana example scripts under `scripts/solana-example/` perform real
on-chain transactions on devnet. They are not unit tests — they require
funded keypairs, a running facilitator, and a running resource server.

### Prerequisites

1. **Build first.** Example scripts import from `dist/` in workspace
   packages. If you skip `make build`, you get stale or missing code.
   A common symptom is the facilitator crashing on startup or the client
   throwing unexpected type errors.

2. **Three funded devnet keypairs are required.** Each is a JSON file
   containing a `[u8; 64]` secret key array. Set them as environment
   variables — `dotenv` files in `apps/facilitator/.env` and
   `scripts/.env` work, or export them directly:

   | Env var              | Role                          |
   | -------------------- | ----------------------------- |
   | `ADMIN_KEYPAIR_PATH` | Facilitator fee payer / admin |
   | `PAYER_KEYPAIR_PATH` | Client (pays for access)      |
   | `PAYTO_KEYPAIR_PATH` | Merchant (receives payment)   |

   All three need devnet SOL. The payer needs USDC and PYUSD token
   accounts funded. The payto needs token accounts created (can be
   unfunded). See `QUICKSTART.md` for faucet links.

3. **Environment variables must reach subprocesses.** The automated
   runner (`run-examples.ts`) spawns the facilitator and resource
   servers as child processes. If you set env vars only in a `.env`
   file at the repo root, the facilitator (which runs from
   `apps/facilitator/`) won't see them. Either export them in the
   shell or place `.env` files in both `apps/facilitator/` and
   `scripts/`.

4. **Kill leftover servers before re-running.** The servers bind to
   ports 3000 and 4000 and don't handle `EADDRINUSE` gracefully:

   ```sh
   lsof -ti:3000,4000 | xargs kill 2>/dev/null
   ```

5. **In a worktree, `touch .env-checked` before `make`.** The
   Makefile's `.env-checked` target runs `bin/check-env` which
   requires `opsh` and configured git hooks. In a worktree or
   automated context, `touch .env-checked` skips it safely.

### Running

The automated runner handles starting/stopping all servers:

```sh
cd scripts
pnpm tsx solana-example/run-examples.ts
```

Or run servers and clients manually (useful for debugging a single
example):

```sh
# Terminal 1: facilitator (port 4000)
ADMIN_KEYPAIR_PATH=... pnpm tsx apps/facilitator/src/index.ts

# Terminal 2: resource server (port 3000)
cd scripts && PAYTO_KEYPAIR_PATH=... pnpm tsx solana-example/server-hono.ts

# Terminal 3: client
cd scripts && PAYER_KEYPAIR_PATH=... pnpm tsx solana-example/solana-exact-payment.ts
```

### Diagnosing failures

- **"no applicable payers found"** — the client's payment handler
  couldn't match any requirement from the 402 response. Check that the
  facilitator is running and returned enriched requirements (look for
  `POST /accepts` in the facilitator log). If `/accepts` returned
  empty `accepts`, the handler's capabilities didn't match the
  resource server's pricing — verify the network format is consistent
  (CAIP-2 everywhere).

- **Facilitator starts with 0 handlers** — env vars aren't reaching
  it. Check that `ADMIN_KEYPAIR_PATH` is set in the facilitator's
  process environment.

- **"bigint: Failed to load bindings"** — harmless warning. Pure JS
  fallback works fine.

## Code Reviews and Pull Requests

When performing code reviews or pull request reviews, load the `code-review`
skill for detailed guidelines on scope determination, convention compliance,
and delegation to sub-agents.
