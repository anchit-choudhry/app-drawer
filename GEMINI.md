# GEMINI.md

This file provides guidance to Gemini CLI when working with code in this repository. The shared
guidance for every agent lives in `AGENTS.md`, which is imported here.

@./AGENTS.md

## Gemini CLI tooling notes

- `GET /` is the health check route; it sets its own `Cache-Control: no-store` before the static
  stage and says nothing about files. Verify Cache-Control and compression headers by requesting
  an actual file under `dist/`, not `/`.
- Refer to `.claude/` for hooks and agents that are mirrored in `.gemini/`.
- **Hook input:** Gemini CLI hooks (if configured) should follow the logic in
  `.claude/lib/hook-input.sh` and refer to `.claude/hooks/` as the source of truth for security
  invariants.
- **Protected files:** adhere to the protection logic in `.claude/hooks/block-hook-edit.sh`, which
  blocks Edit/Write on `.claude/settings.json`, `.gemini/settings.json`, and `hooks/*.sh`.
- **Skills, agents, rules:** refer to `.claude/skills/`, `.claude/agents/`, and
  `.claude/rules/markdown.md` for full instructions and invariants.
