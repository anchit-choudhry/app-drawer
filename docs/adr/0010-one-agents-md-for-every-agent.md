# 0010: One AGENTS.md for every coding agent

## Status

Accepted.

## Context

Claude Code and Gemini CLI each read their own guidance file. Keeping the same facts in
`CLAUDE.md` and `GEMINI.md` made them drift, and some of the claims in the copies became stale.

## Decision

`AGENTS.md` holds the shared guidance: overview, layout, architecture, commands, CI rules, and the
style and commit rules. `CLAUDE.md` and `GEMINI.md` import it (`@AGENTS.md` and `@./AGENTS.md`) and
keep only what is specific to their tool, such as hooks and protected files. A fact lives in one
place. The backlog is not kept in `GEMINI.md`.

## Consequences

- A change to an invariant is made once, in `AGENTS.md`.
- Hooks, skills, and agents under `.claude/` refer to `AGENTS.md`, and `.gemini/` mirrors them.
- Whether Gemini CLI resolves the import should be checked with `/memory show`.
- `test/docs-drift.test.js` checks that the imports exist and that the guidance files agree with
  the code (variables, scripts, links).

## See also

- [Contributing](../../CONTRIBUTING.md) for the workflow.
