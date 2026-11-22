# Gemini Configuration

This directory contains Gemini-specific configurations and references to project-wide invariants.

## Single Source of Truth

To ensure information is maintained in one location, most Gemini-specific files refer to their
counterparts in the `.claude/` directory.

### Mirrors and References

- **Agents:** See [.gemini/agents/](agents/express-security-reviewer.md)
  (Mirrors [.claude/agents/](../.claude/agents/))
- **Skills:** See [.gemini/skills/](skills/dependency-update/SKILL.md)
  (Mirrors [.claude/skills/](../.claude/skills/))
- **Hooks:** Listed in [Hooks mirrored from Claude](#hooks-mirrored-from-claude) below
  (References [.claude/hooks/](../.claude/hooks/))
- **Rules:** See [.gemini/rules/](rules/markdown.md) (Mirrors [.claude/rules/](../.claude/rules/))

## Hooks mirrored from Claude

These hooks mirror the logic in `.claude/hooks/`. While Gemini may not execute them automatically
from the repo, they represent core safety invariants for this project.

- [block-dangerous-git.sh][dangerous-git]: Prevents destructive git operations (force push to
  main, reset --hard, etc).
- [block-env-edit.sh][env-edit]: Blocks edits to sensitive `.env` files.
- [block-rm-outside-repo.sh][rm-outside]: Prevents `rm` commands from targeting paths outside the
  repository.
- [warn-core-files.sh][core-files]: Provides reminders when editing core files like `server.js`.
- [block-git-commit.sh][git-commit]: Blocks `git commit` from the agent session; the user manages
  commits.
- [block-hook-edit.sh][hook-edit]: Blocks edits to the settings files, the hooks, and the hook
  libraries (`.claude/lib/`), so guardrails cannot be weakened by the agent.
- [hook-input.sh][hook-input]: Shared helper that parses the hook JSON payload from stdin for the
  hooks above. A guard hook blocks when it cannot read the payload.
- `command_guard.py` (next to `hook-input.sh`): the command parser the three Bash guards share. It
  reads separators, `bash -c`, `eval`, `$(...)`, wrappers, and a `cd` earlier in the command.

## Project Guidance

Foundational guidance for all AI agents is maintained in the root [GEMINI.md](../GEMINI.md).

[dangerous-git]: ../.claude/hooks/block-dangerous-git.sh
[env-edit]: ../.claude/hooks/block-env-edit.sh
[rm-outside]: ../.claude/hooks/block-rm-outside-repo.sh
[core-files]: ../.claude/hooks/warn-core-files.sh
[git-commit]: ../.claude/hooks/block-git-commit.sh
[hook-edit]: ../.claude/hooks/block-hook-edit.sh
[hook-input]: ../.claude/lib/hook-input.sh
