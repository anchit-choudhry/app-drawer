# Git Hooks for Gemini

These hooks mirror the logic in `.claude/hooks/`. While Gemini may not execute these automatically from the repo, they represent core safety invariants for this project.

- [block-dangerous-git.sh](../../.claude/hooks/block-dangerous-git.sh): Prevents destructive git operations (force push to main, reset --hard, etc).
- [block-env-edit.sh](../../.claude/hooks/block-env-edit.sh): Blocks edits to sensitive `.env` files.
- [block-rm-outside-repo.sh](../../.claude/hooks/block-rm-outside-repo.sh): Prevents `rm` commands from targeting paths outside the repository.
- [warn-core-files.sh](../../.claude/hooks/warn-core-files.sh): Provides reminders when editing core files like `server.js`.
