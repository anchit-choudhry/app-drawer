#!/usr/bin/env bash
# Blocks destructive git commands before they run.
# Hard-blocks (exit 2): a force push to main/master or with no branch named (the current branch
# may be main), a --mirror push, a + or : refspec or --delete aimed at main/master, reset --hard,
# clean -f (unless it is a dry run), and branch -D (or -d with -f). Recognised whatever the flag
# spelling (`-f`, `-uf`, `--force`, `--force-with-lease`) and behind git's global options
# (`git -C . push`). The parsing lives in lib/command_guard.py.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/../lib/hook-input.sh"
hook_require_parsed
COMMAND="$HOOK_COMMAND"

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

python3 "$HOOK_DIR/../lib/command_guard.py" git-danger "$COMMAND"
status=$?
if [[ $status -eq 0 ]]; then
  exit 0
fi
exit 2
