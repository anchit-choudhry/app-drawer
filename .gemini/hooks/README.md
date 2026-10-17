# Git Hooks for Gemini

These hooks mirror the logic in `.claude/hooks/`. While Gemini may not execute these automatically
from the repo, they represent core safety invariants for this project.

- [block-dangerous-git.sh][dangerous-git]: Prevents destructive git operations (force push to
  main, reset --hard, etc).
- [block-env-edit.sh][env-edit]: Blocks edits to sensitive `.env` files.
- [block-rm-outside-repo.sh][rm-outside]: Prevents `rm` commands from targeting paths outside the
  repository.
- [warn-core-files.sh][core-files]: Provides reminders when editing core files like `server.js`.
- [block-git-commit.sh][git-commit]: Blocks `git commit` from the agent session; the user manages
  commits.
- [block-hook-edit.sh][hook-edit]: Blocks edits to `settings.json` and `hooks/*.sh`, so guardrails
  cannot be weakened by the agent.
- [hook-input.sh][hook-input]: Shared helper that parses the hook JSON payload from stdin for the
  hooks above.

[dangerous-git]: ../../.claude/hooks/block-dangerous-git.sh
[env-edit]: ../../.claude/hooks/block-env-edit.sh
[rm-outside]: ../../.claude/hooks/block-rm-outside-repo.sh
[core-files]: ../../.claude/hooks/warn-core-files.sh
[git-commit]: ../../.claude/hooks/block-git-commit.sh
[hook-edit]: ../../.claude/hooks/block-hook-edit.sh
[hook-input]: ../../.claude/lib/hook-input.sh
