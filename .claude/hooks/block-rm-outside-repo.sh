#!/usr/bin/env bash
# Blocks `rm` (including `rm -f`, `rm -rf`, `sudo rm`), `rmdir`, `unlink`, `shred`, and
# `find ... -delete` / `find ... -exec rm` whose target resolves outside the project repo root, or
# cannot be resolved at all (an unset variable, a command substitution). Looks inside `bash -c`,
# `eval`, and `$(...)`, and follows a `cd` earlier in the same command. The parsing lives in
# lib/command_guard.py.
# Invoked WITHOUT a leading `cd "$root"` - relative targets are resolved against the real
# working directory of the pending command.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/../lib/hook-input.sh"
hook_require_parsed
COMMAND="$HOOK_COMMAND"

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# The repository this hook belongs to. It does not depend on the working directory, so a
# session that has moved to another directory is still checked.
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"

python3 "$HOOK_DIR/../lib/command_guard.py" rm "$COMMAND" "$REPO_ROOT"
status=$?
if [[ $status -eq 0 ]]; then
  exit 0
fi
exit 2
