#!/usr/bin/env bash
# Blocks `git commit` (including `git commit --amend`, `git -C <dir> commit`,
# and commit invoked as part of a `&&`/`;`/`|` chain) before it runs.
# CLAUDE.md's "Commit Safety" rule says commits are never created automatically.
# That was previously enforced only by instruction; this hook makes it
# non-negotiable the same way block-rm-outside-repo.sh is for its rule.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
COMMAND="$HOOK_COMMAND"

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

RESULT=$(python3 -c "
import shlex, sys

command = sys.argv[1]

try:
    tokens = shlex.split(command)
except ValueError:
    print('OK')
    sys.exit(0)

GIT_GLOBAL_FLAGS_WITH_ARG = {'-C', '-c', '--git-dir', '--work-tree', '--namespace'}

is_commit = False
i = 0
while i < len(tokens):
    if tokens[i] == 'git' or tokens[i].endswith('/git'):
        j = i + 1
        while j < len(tokens):
            tok = tokens[j]
            if tok in GIT_GLOBAL_FLAGS_WITH_ARG:
                j += 2
                continue
            if tok.startswith('-'):
                j += 1
                continue
            break
        if j < len(tokens) and tokens[j] == 'commit':
            is_commit = True
            break
    i += 1

print('BLOCK' if is_commit else 'OK')
" "$COMMAND")

if [[ "$RESULT" == "OK" ]]; then
  exit 0
fi

echo "BLOCKED: git commit is not allowed from this session." >&2
echo "The user manages all commits themselves - see CLAUDE.md's Commit Safety rule." >&2
echo "Stage changes if asked, but leave committing to the user." >&2
echo "Offending command: $COMMAND" >&2
exit 2
