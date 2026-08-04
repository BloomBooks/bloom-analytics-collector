# Agent guidance for bloom-analytics-collector

A small Node/TypeScript CLI that collects the quarterly LangTech Software Metrics
for the Bloom products and writes a paste-ready grid for the metrics dashboard.
See [README.md](README.md) for what it does and why each number comes from where
it does.

## Issue tracker

This project tracks work in **YouTrack** (the Bloom tracker). Ticket ids look like
**`BL-1234`**, and branches carrying one should include it in the branch name so
tooling can find it. Talk to the tracker through the **`youtrack-*` skills** —
`youtrack-api` for the low-level REST operations, `youtrack-fix` when given a
ticket id, `youtrack-create-issue` to file one.

Not every change here will have a card: this is a small internal tool, and a
branch with no `BL-` id in its name simply has no card. That is a normal outcome,
not something to go hunting for.

## Toolchain

- Package manager is **pnpm**. Never use npm or yarn.
- `pnpm typecheck` — `tsc --noEmit`. There is no lint script; typecheck plus the
  tests are the gate.
- `pnpm test` — `vitest run`. Non-watch. Never invoke a watch-mode runner.
- `pnpm collect` — runs the tool itself; see the README for flags.

## Code style

- Arrow functions and `const` throughout; no classes.
- Comment public functions, and most private ones. Say *why*, not *what* — the
  comments here carry hard-won findings (which Play metric is correct and why,
  which Mixpanel endpoints the plan blocks) and are the most valuable part of the
  file when the next quarter comes round.
- Avoid removing existing comments unless a change makes them inaccurate.

## Fail fast

Don't work around a missing dependency or an unexpected shape. If a source
returns something unexpected, throw with a message naming what was expected and
what arrived. A wrong number that looks plausible is far worse here than a run
that stops — these figures get reported onward.

## Things that are deliberately the way they are

Before "fixing" any of these, read the reasoning in the README and the code
comments:

- Metrics come from Mixpanel's **raw event export**, not its saved reports,
  because the plan rejects every aggregate query endpoint with HTTP 402.
- `output/` is committed on purpose: it is the record of past quarters.
- Provenance is redacted by `src/sanitize.ts` before anything is written to
  `output/`, because this repo is public and a captured cloud error once carried
  identifiers into a commit.
- Bloom Reader's Installs uses Play's `Daily Device Installs` (Google's
  uniques-based "New devices"), not the events-based variants, which run 55–63%
  higher.
