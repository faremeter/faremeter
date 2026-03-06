# AGENTS.md

Instructions for AI agents working in this repository.

## Session Initialization

At the start of every session, before doing any other work:

1. Read `CONVENTIONS.md` and follow all conventions defined there
2. Read `DEV.md` only if the task involves building, testing, or environment setup

Load skills on demand — do NOT pre-load all skills at session start:
- `skills/code-review/SKILL.md` — load when performing code or PR reviews
- `skills/debug-test-harness/SKILL.md` — load when debugging test harness issues
- `skills/run-examples/SKILL.md` — load when running examples

## x402 Payment Protocol

For all x402-related operations, use local `@faremeter` packages unless explicitly instructed otherwise.
**Do not use experimental x402 payment schemes unless explicitly told to do so.**

### x402 Implementation Map

When working on x402 payment flows, use this as your orientation to avoid unnecessary exploration:

**Key interfaces (read these first):**
- `packages/types/src/x402v2.ts` — current x402 v2 protocol types
- `packages/types/src/client.ts` — `PaymentHandler` and `PaymentExecer` (client-side interface to implement)
- `packages/types/src/facilitator.ts` — `FacilitatorHandler` (facilitator-side interface to implement)

**Reference implementations:**
- `packages/payment-evm/` — EVM client-side handler (canonical example of a `PaymentHandler`)
- `packages/payment-solana/` — Solana client-side handler
- `packages/wallet-evm/` — EVM wallet (provides signing for the payment handler)
- `packages/wallet-solana/` — Solana wallet
- `packages/facilitator/src/routes.ts` — how multiple `FacilitatorHandler` plugins are composed
- `apps/facilitator/` — the running facilitator application

**Adding a new payment scheme** — follow the pattern in `packages/payment-evm/`:
1. Create `packages/payment-{name}/` with `src/index.ts`
2. Implement `PaymentHandler` (client side) to construct payment headers
3. Implement `FacilitatorHandler` (facilitator side) to verify receipts and settle payments
4. Export via a barrel `src/index.ts` matching the existing package structure

## Additional Conventions

See `CONVENTIONS.md` for complete development conventions including:

- Package management with pnpm catalog
- TypeScript configuration
- Code style and linting
- Build verification (`make` before completing tasks)

## Build Requirements

**CRITICAL:** Run `make` at the repo root before declaring any task complete. Individual package builds (`make build`, `make test`, etc.) are not acceptable substitutes — only a full `make` verifies the entire monorepo.

If `make` fails, report the failure and identify the cause. If the failure is pre-existing and unrelated to your changes, say so explicitly and let the user decide how to proceed.

## Code Reuse and Refactoring

Search for existing implementations before writing new code. If similar functionality exists, prefer refactoring over reimplementing. When a refactor might be needed, pause and ask the user which approach to take — offer specific options (refactor existing, promote to shared package, create new) and allow them to provide their own answer.

## Personality

Do not use emojis in code or documentation, or attempt to be cute with your aesthetic. Act like a professional.

## Configuration

Do not modify configuration files (e.g. eslint, prettier) unless explicitly asked to. Your job is to write working software not change the conventions that are being used.

## Code Reviews and Pull Requests

When performing code reviews or pull request reviews, load the `code-review`
skill for detailed guidelines on scope determination, convention compliance,
and delegation to sub-agents.
