# GEMINI.md

This file provides guidance to Gemini CLI when working with code in this repository. The shared
guidance for every agent lives in `AGENTS.md`, which is imported here.

@./AGENTS.md

## Gemini CLI tooling notes

- Verify Cache-Control and compression headers by requesting a real file under `dist/`; `GET /`
  sets its own `Cache-Control: no-store` before the static stage, so it says nothing about files.
- Refer to `.claude/` for hooks and agents that are mirrored in `.gemini/`.
- Run a single test file through `npm test --workspace=express-static-serve -- test/<file>`.
- **Hook input:** Gemini CLI hooks (if configured) should follow the logic in
  `.claude/lib/hook-input.sh` and refer to `.claude/hooks/` as the source of truth for security
  invariants.
- **Protected files:** adhere to the protection logic in `.claude/hooks/block-hook-edit.sh`, which
  blocks Edit/Write on `.claude/settings.json`, `.gemini/settings.json`, and `hooks/*.sh`.
- **Skills, agents, rules:** skills `dependency-update`, `owasp-security-audit`, and
  `web-security-audit`; agent `express-security-reviewer` (run it after editing `server.js`, and
  tell it which changes are deliberate); `.claude/rules/markdown.md` is the Markdown style rule,
  adapted to the markdownlint config.
