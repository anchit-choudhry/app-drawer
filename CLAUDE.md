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
  piping JSON into it. The three Bash guards parse the command in `.claude/lib/command_guard.py`:
  it reads `;`, `&&`, `|`, `bash -c`, `eval`, `$(...)`, backticks, wrappers such as `sudo` and
  `env`, git's global options, and a `cd` earlier in the same command. Text inside quotes is not
  a command, but unquoted words are, so `echo git commit` is still blocked. It is a guardrail, not
  a sandbox: a command assembled at run time (base64, a variable that holds a command) cannot be
  read, and the permission prompt stays the control for those. A hook that cannot read its input
  (no `python3`, a payload that is not JSON) blocks instead of passing. Claude never sees stdout
  or stderr from a PreToolUse hook that exits 0, so a reminder (`warn-core-files.sh`) is printed
  as JSON with `hookSpecificOutput.additionalContext` instead.
- **Protected files:** `block-hook-edit.sh` blocks Edit/Write on `.claude/settings.json`,
  `.claude/settings.local.json`, everything under `.claude/hooks/` and `.claude/lib/`, and the
  `.gemini` equivalents, ignoring case and resolving `..` and symbolic links. Describe the exact
  change and the user applies it. `block-git-commit.sh` likewise blocks `git commit` from the
  session (also `commit-tree` and a `-c alias.x=commit` alias), which enforces the commit safety
  rule in `AGENTS.md`. `block-rm-outside-repo.sh` blocks `rm`, `rmdir`, `unlink`, `shred`, and
  `find -delete` on anything that resolves outside the repository, or cannot be resolved (an unset
  variable, `cd "$X"`). `block-dangerous-git.sh` blocks a force push to `main` or `master` or with
  no branch named, `--mirror`, `reset --hard`, `clean -f`, and `branch -D`, in any flag spelling.
- **Personal sound hook:** `.claude/hooks/notification-alert.sh` plays a macOS sound on
  notifications. It is git-ignored and registered in the git-ignored `.claude/settings.local.json`,
  not in the shared `settings.json`; the same script step creates that registration.
- **Skills, agents, rules:** skills `dependency-update`, `owasp-security-audit`, and
  `web-security-audit`; agent `express-security-reviewer` (run it after editing `server.js`, and
  tell it which changes are deliberate); `.claude/rules/markdown.md` is the Markdown style rule,
  adapted to the markdownlint config.
