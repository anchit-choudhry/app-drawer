# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository. The shared guidance for every agent lives in `AGENTS.md`, which is imported here.

@AGENTS.md

## Claude Code tooling notes

- Hook commands in `.claude/settings.json` can use `$CLAUDE_PROJECT_DIR` to reference the repository
  root - no need for a `git rev-parse --show-toplevel` wrapper.
- Verify Cache-Control and compression headers by requesting a real file under `dist/`; `GET /`
  sets its own `Cache-Control: no-store` before the static stage, so it says nothing about files.
- Run a single test file through `npm test --workspace=express-static-serve -- test/<file>`: the
  settings already allow `npm test*`, which avoids a permission prompt that a bare `node --test`
  would raise.
- **Permission prompts:** read-only commands are added to `permissions.allow` in
  `.claude/settings.json` (the `fewer-permission-prompts` skill finds them). That file is
  protected, so give the user the exact lines to add. Never allowlist an interpreter, a shell, or a
  task-runner wildcard.
- **Hook input:** hooks read the PreToolUse JSON from stdin through `.claude/lib/hook-input.sh`
  (`HOOK_COMMAND`, `HOOK_FILE_PATH`). Never read `CLAUDE_TOOL_INPUT`: Claude Code does not set it,
  so a hook that does is a silent no-op. Block messages go to stderr with exit 2. Test a hook by
  piping JSON into it. Hooks match against the whole command text, so a command that merely
  mentions a blocked pattern (for example in an `echo`) is blocked too. Claude never sees stdout
  or stderr from a PreToolUse hook that exits 0, so a reminder (`warn-core-files.sh`) is printed
  as JSON with `hookSpecificOutput.additionalContext` instead.
- **Protected files:** `block-hook-edit.sh` blocks Edit/Write on `.claude/settings.json`,
  `.gemini/settings.json`, and `hooks/*.sh`. Describe the exact change and the user applies it;
  `.claude/lib/` is deliberately outside that glob. `block-git-commit.sh` likewise blocks
  `git commit` from the session, which enforces the commit safety rule in `AGENTS.md`.
  `block-rm-outside-repo.sh` blocks `rm` on anything that resolves outside the repository.
- **Personal sound hook:** `.claude/hooks/notification-alert.sh` plays a macOS sound on
  notifications. It is git-ignored and registered in the git-ignored `.claude/settings.local.json`,
  not in the shared `settings.json`; the same script step creates that registration.
- **Skills, agents, rules:** skills `dependency-update`, `owasp-security-audit`, and
  `web-security-audit`; agent `express-security-reviewer` (run it after editing `server.js`, and
  tell it which changes are deliberate); `.claude/rules/markdown.md` is the Markdown style rule,
  adapted to the markdownlint config.
