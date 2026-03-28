# Contributing to Faremeter

We welcome contributions that improve Faremeter's core libraries, fix bugs, expand test coverage, or improve documentation. Before contributing, please familiarize yourself with the project:

- [ARCHITECTURE.md](./ARCHITECTURE.md) -- Design philosophy and high-level structure
- [CONVENTIONS.md](./CONVENTIONS.md) -- Code style, naming, testing, and commit conventions
- [DEV.md](./DEV.md) -- Development environment setup and build commands

## Getting Started

Follow [DEV.md](./DEV.md) to set up your environment, then run `make` to verify everything builds and tests pass. See [QUICKSTART.md](./QUICKSTART.md) for end-to-end usage examples.

## What We Accept

- Bug fixes with reproduction steps or failing tests
- Test coverage improvements for untested code paths
- Documentation fixes and clarifications
- Performance improvements with benchmarks or profiling evidence
- New payment scheme implementations that follow the existing plugin architecture

## What We Don't Accept

- Unsolicited third-party plugins or integrations without prior discussion
- PRs that bundle unrelated changes (formatting fixes mixed with features, etc.)
- Changes to configuration files (eslint, prettier, tsconfig) without explicit approval

If you're unsure whether a contribution fits, open an issue first to discuss.

## Pull Request Process

1. **Branch from `main`** and keep your branch focused on a single change.
2. **Run `make`** before submitting. The full build must pass -- do not substitute individual targets.
3. **Follow commit conventions** described in [CONVENTIONS.md](./CONVENTIONS.md). Summary lines should be plain English sentences, max 72 characters, no prefixes like `feat:` or `fix:`.
4. **Separate refactors from features.** If your change requires a refactor, submit it as a separate commit or PR.
5. **Co-locate tests** with source files (`*.test.ts`). New functionality should include tests for the logic it introduces.
6. **Update documentation** in the same commit as the code change, not as a follow-up.

## Code Review

Every PR requires review before merging. Reviewers will check:

- Correctness and adherence to project conventions
- Test coverage for new logic and edge cases
- Whether the change introduces unnecessary complexity
- Commit history reads clearly (see [CONVENTIONS.md](./CONVENTIONS.md#git-workflow))

Please be responsive to review feedback. If a conversation stalls, the PR may be closed.

## Security

If you discover a security vulnerability, do not open a public issue. See [SECURITY.md](./SECURITY.md) for responsible disclosure instructions.
