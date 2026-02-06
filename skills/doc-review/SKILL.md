---
name: doc-review
description: Review documentation against codebase and cross-check across doc sites (faremeter, corbits)
argument-hint: "init | review"
---

# Documentation Review

Review documentation for accuracy by cross-checking claims against the codebase
and across multiple documentation sites.

## Subcommands

| Command              | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `/doc-review init`   | Check MCP servers and set up `DOC_REVIEW.md` for a new or existing review |
| `/doc-review review` | Run a full review (requires init)                                         |

If invoked without a subcommand (`/doc-review`), print a help summary listing
the available subcommands with a brief description of each. Do not start a
review automatically.

## Tools

- **Faremeter docs MCP** (`SearchFaremeter`) -- search `docs.faremeter.xyz`
- **Corbits docs MCP** (`SearchCorbitsDev`) -- search `docs.corbits.dev`
- **Codebase** (`Read`, `Grep`, `Glob`) -- verify function signatures, types, exports, network tables
- **Bash** (`curl`) -- query live endpoints (e.g. `GET https://facilitator.corbits.dev/supported`)

---

## `init` -- Initialize a Review Session

### Step 1: Precheck MCP servers

Verify that the required MCP servers are available. Check whether the following
tools exist in your available tool list (do not call them):

- `mcp__faremeter-docs__SearchFaremeter`
- `mcp__corbits-docs__SearchCorbitsDev`

Present the results as a status table:

```
| MCP Server     | Status |
|----------------|--------|
| faremeter-docs | [check or x] |
| corbits-docs   | [check or x] |
```

Use a green checkmark for connected, red X for missing.

If any servers are missing, show the user how to add them:

```
claude mcp add --transport http faremeter-docs https://faremeter.mintlify.app/mcp
claude mcp add --transport http corbits-docs https://docs.corbits.dev/mcp
```

Only show the commands for the missing servers. Tell the user to restart the
session after adding them.

If `faremeter-docs` is missing, stop -- the review cannot proceed without
faremeter docs access. If `corbits-docs` is missing, use `AskUserQuestion` to
ask whether to continue without cross-checking. If the user declines, stop.

### Step 2: Resume or start fresh

Check whether `DOC_REVIEW.md` already exists at the repository root.

**If it exists**, read the metadata block and use `AskUserQuestion` to ask the
user how to proceed:

- **Continue** -- keep the existing file. Treat sections that already have
  findings as complete. The review will focus on docs pages and topic areas
  not yet covered. If a new finding affects an existing section, it will be
  added to that section.
- **Start fresh** -- delete the file and begin a new review from scratch.

**If it does not exist**, proceed directly to Step 3.

### Step 3: Write the metadata file

Write `DOC_REVIEW.md` with the metadata block and empty section scaffolding (see
"Review file format" below). If continuing an existing file, update only the
metadata fields that changed.

Set `reviewed-at` to today's date. Set `sites` to the doc sites that are
available (always `faremeter`; add `corbits` if the corbits-docs MCP is
connected).

After writing, confirm to the user that init is complete and they can run
`/doc-review review` to start the review.

---

## `review` -- Full Documentation Review

### Prerequisite

Check that `DOC_REVIEW.md` exists at the repository root and contains a valid
metadata block (HTML comment with at least `reviewed-at` and `sites` fields).

If the file does not exist or has no metadata block, tell the user to run
`/doc-review init` first and stop.

### Step 1: Crawl the docs

Use `SearchFaremeter` to discover all major docs pages. Search broadly by topic
area: wallets, payment handlers, facilitator, middleware, fetch wrapper, rides,
networks, concepts, recipes, and API reference.

### Step 2: For each page, compare examples against code

For every code example on a docs page:

1. Identify the function being called and the package it comes from.
2. Read the actual source file for that function. Check the real signature,
   parameter names, parameter types, and return type.
3. Check that the import path in the docs matches an actual package export.
4. Check that the argument values are valid (e.g. network names match
   `KnownNetwork`, mint values use the correct type).
5. Check runtime behavior, not just types. If a parameter is typed as
   `PublicKey`, check whether the function calls methods on it (e.g.
   `.toBase58()`). A plain string would crash at runtime.

### Step 3: Check data tables and support claims

1. Compare network lists, asset tables, and supported chain lists against the
   source of truth in `packages/info/src/`.
2. For claims about what the Corbits facilitator supports, query the live
   endpoint directly:
   ```bash
   curl -s https://facilitator.corbits.dev/supported | jq .
   ```
   Do not infer hosted service behavior from code or from other docs pages.
   The live endpoint is the ground truth.

### Step 4: Check for missing documentation

1. Search for working examples in `scripts/` that have no corresponding docs
   page.
2. Check for config options, feature flags, and function parameters in code
   that are not documented.
3. Check for protocol version support (v1 vs v2) that docs do not mention.

### Step 5: Verify, cross-check, and write each finding

For each potential finding, verify it before writing it to the review file.
Write findings to `DOC_REVIEW.md` incrementally as they are verified. Do not
batch them up for a later write step.

**Verify against code:**

1. Read the actual source file at the cited line. Do not infer signatures from
   memory or documentation.
2. Check exports. If claiming a function does not exist, read the package entry
   point and confirm.
3. Check enums and constant arrays. If citing valid values for a type, read the
   source and list actual values.

**Verify against docs:**

1. Search the docs MCP with a query specific enough to find the exact page and
   code example.
2. Quote the actual docs text. Do not paraphrase.
3. If the docs MCP returns no match, say so explicitly. Do not claim a page says
   something you cannot find.

**Cross-check across doc sites** (skip if `sites` metadata only lists `faremeter`):

1. Search the other docs MCP for the same topic.
2. Note whether the other site has the same error, a correct version, or no
   coverage.
3. Do not assume one site is correct based on the other. Verify independently.
4. Add a cross-check annotation to the finding in the review file.

Do not hedge. Either the finding is verified or it is not. Only write verified
findings to the review file.

### Step 6: Report summary

After all pages have been reviewed, report a summary to the user listing how
many findings were recorded at each priority level.

---

## Review File Format

`DOC_REVIEW.md` starts with a metadata block (HTML comment) followed by the
findings.

```markdown
<!--
reviewed-at: 2026-02-06
sites: faremeter, corbits
-->

# Documentation Review: Findings and Fixes

## Context

Brief description of the review scope and methodology.

---

## 1. High Priority: Broken Code Examples

### 1.1 Finding title

**Pages affected:**

- https://docs.faremeter.xyz/...

**Problem:** What the docs say vs what the code does.

**Code ref:** `packages/.../src/file.ts:line`

**Fix:** The corrected code or text.

---

## 2. Medium Priority: Data Drift

...

## 3. Low Priority: Missing Guides

...

## Priority Fix List

### High

1. ...

### Medium

2. ...

### Low

3. ...

## Verification Notes

Methods used to validate findings.
```

---

## Common Mistakes to Avoid

1. **Do not claim a docs page says something without searching the docs MCP
   first.** Memory of what a page says is unreliable. Search and quote.

2. **Do not conflate codebase support with hosted service support.** The code
   may define 7 EVM networks. The Corbits facilitator may serve 11 (or 5). These
   are different questions with different sources of truth.

3. **Do not create redundant sections.** If multiple findings describe the same
   underlying issue (e.g. "missing networks" on 3 different pages), consolidate
   them into one finding that lists all affected pages.

4. **Do not speculate.** If you cannot verify a claim, say "I cannot verify this"
   rather than hedging with qualifiers like "might" or "could".

5. **Do not conflate what one docs site says with what the other says.** Faremeter
   docs and Corbits docs may have different errors on the same topic. Verify each
   independently.
