#!/usr/bin/env bash
# Blocks `git commit` before it runs, however it is written: `git -C <dir> commit`, commit in a
# `&&`/`;`/`|` chain (with or without spaces around the separator), inside `bash -c`, `eval`, or
# `$(...)`, behind `sudo` or `env`, `git commit-tree`, and `git -c alias.x=commit x`.
# AGENTS.md's "Commit safety" rule says commits are never created automatically. That was
# previously enforced only by instruction; this hook makes it non-negotiable the same way
# block-rm-outside-repo.sh is for its rule. The parsing lives in lib/command_guard.py.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/../lib/hook-input.sh"
hook_require_parsed
COMMAND="$HOOK_COMMAND"

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

python3 "$HOOK_DIR/../lib/command_guard.py" git-commit "$COMMAND"
status=$?
if [[ $status -eq 0 ]]; then
  exit 0
fi
exit 2
