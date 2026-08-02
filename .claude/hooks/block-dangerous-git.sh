#!/usr/bin/env bash
# Blocks destructive git commands before they run.
# Hard-blocks (exit 2): force push to main/master, reset --hard, clean -f, branch -D.
set -uo pipefail

COMMAND=$(python3 -c "
import json, os
d = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
print(d.get('command', ''))
" 2>/dev/null || echo "")

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

if printf '%s\n' "$COMMAND" | grep -qE "git push.*(--force|-f).*(main|master)" ||
  printf '%s\n' "$COMMAND" | grep -qE "git push.*(main|master).*(--force|-f)"; then
  echo "BLOCKED: Force push to main/master is not allowed."
  echo "Use a feature branch and open a PR instead."
  exit 2
fi

if printf '%s\n' "$COMMAND" | grep -qE "git reset --hard"; then
  echo "BLOCKED: 'git reset --hard' discards uncommitted changes permanently."
  echo "Use 'git stash' to save work first, or confirm this is intentional."
  exit 2
fi

if printf '%s\n' "$COMMAND" | grep -qE "git clean -f"; then
  echo "BLOCKED: 'git clean -f' permanently deletes untracked files."
  echo "Run 'git clean -n' first to preview what would be deleted."
  exit 2
fi

if printf '%s\n' "$COMMAND" | grep -qE "git branch -D "; then
  echo "BLOCKED: 'git branch -D' force-deletes a branch without merge check."
  echo "Use 'git branch -d' (lowercase) for a safe delete, or confirm intentional."
  exit 2
fi

exit 0
