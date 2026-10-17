#!/usr/bin/env bash
# Blocks destructive git commands before they run.
# Hard-blocks (exit 2): force push to main/master, reset --hard, clean -f, branch -D.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
COMMAND="$HOOK_COMMAND"

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

FORCE_RE='[[:space:]](--force|-f)([^[:alnum:]]|$)'
BRANCH_RE='[[:space:]:/](main|master)([^[:alnum:]_./-]|$)'
# Checked separately, not as one regex, so the order of flag and branch does not matter.
if printf '%s\n' "$COMMAND" | grep -qE "git push" &&
  printf '%s\n' "$COMMAND" | grep -qE "$FORCE_RE" &&
  printf '%s\n' "$COMMAND" | grep -qE "$BRANCH_RE"; then
  echo "BLOCKED: Force push to main/master is not allowed." >&2
  echo "Use a feature branch and open a PR instead." >&2
  exit 2
fi

# A '+' refspec force-pushes without --force; --delete or a ':main' refspec removes
# the branch.
PROTECTED_PUSH_RES=(
  "git push.*[[:space:]]\+[^[:space:]]*(main|master)([^[:alnum:]_./-]|$)"
  "git push.*[[:space:]](--delete|-d)[[:space:]].*(main|master)([^[:alnum:]_./-]|$)"
  "git push.*[[:space:]]:(main|master)([^[:alnum:]_./-]|$)"
)
for re in "${PROTECTED_PUSH_RES[@]}"; do
  if printf '%s\n' "$COMMAND" | grep -qE "$re"; then
    echo "BLOCKED: A + refspec push to, or deleting, main/master is not allowed." >&2
    echo "Use a feature branch and open a PR instead." >&2
    exit 2
  fi
done

if printf '%s\n' "$COMMAND" | grep -qE "git reset --hard"; then
  echo "BLOCKED: 'git reset --hard' discards uncommitted changes permanently." >&2
  echo "Use 'git stash' to save work first, or confirm this is intentional." >&2
  exit 2
fi

if printf '%s\n' "$COMMAND" | grep -qE "git clean -f"; then
  echo "BLOCKED: 'git clean -f' permanently deletes untracked files." >&2
  echo "Run 'git clean -n' first to preview what would be deleted." >&2
  exit 2
fi

if printf '%s\n' "$COMMAND" | grep -qE "git branch -D "; then
  echo "BLOCKED: 'git branch -D' force-deletes a branch without merge check." >&2
  echo "Use 'git branch -d' (lowercase) for a safe delete, or confirm intentional." >&2
  exit 2
fi

exit 0
