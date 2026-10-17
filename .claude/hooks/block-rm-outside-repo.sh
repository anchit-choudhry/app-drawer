#!/usr/bin/env bash
# Blocks `rm` (including `rm -f`, `rm -rf`, `sudo rm`) commands whose target
# path resolves outside the project repo root.
# Invoked WITHOUT a leading `cd "$root"` - relative rm targets must be
# resolved against the real working directory of the pending command.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
COMMAND="$HOOK_COMMAND"

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$REPO_ROOT" ]]; then
  exit 0
fi

RESULT=$(python3 -c "
import os, shlex, sys

command = sys.argv[1]
repo_root = os.path.realpath(sys.argv[2])

try:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    tokens = list(lexer)
except ValueError:
    print('OK')
    sys.exit(0)

rm_indices = [i for i, t in enumerate(tokens) if t == 'rm' or t.endswith('/rm')]
if not rm_indices:
    print('OK')
    sys.exit(0)

offenders = []
for idx in rm_indices:
    for tok in tokens[idx + 1:]:
        if set(tok) <= set('();<>|&'):
            break
        if tok.startswith('-'):
            continue
        expanded = os.path.expandvars(os.path.expanduser(tok))
        target = os.path.realpath(expanded)
        if target != repo_root and not target.startswith(repo_root + os.sep):
            offenders.append((tok, target))

if offenders:
    for tok, target in offenders:
        print(f'{tok}\t{target}')
else:
    print('OK')
" "$COMMAND" "$REPO_ROOT")

if [[ "$RESULT" == "OK" ]]; then
  exit 0
fi

echo "BLOCKED: rm target resolves outside the project directory ($REPO_ROOT)." >&2
while IFS=$'\t' read -r tok target; do
  echo "  '$tok' -> $target" >&2
done <<<"$RESULT"
echo "Offending command: $COMMAND" >&2
exit 2
