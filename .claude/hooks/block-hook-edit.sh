#!/usr/bin/env bash
# Hard-blocks Edit/Write on the security-enforcement files themselves:
# .claude/settings.json, .claude/settings.local.json, everything under .claude/hooks/ and
# .claude/lib/ (every hook sources lib/hook-input.sh, so it is as sensitive as a hook), and the
# .gemini equivalents. The match ignores case (the default macOS file system does) and resolves
# ".." and symbolic links first.
# These must only be changed by the user directly, in their own editor -
# never via the Edit/Write tool. This closes the gap where a compromised or
# prompt-injected agent could quietly weaken its own guardrails. Intentional
# tradeoff: the assistant must describe the exact change and the user applies
# it manually; see CLAUDE.md's "Claude Code tooling notes" section.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/../lib/hook-input.sh"
hook_require_parsed
FILE_PATH="$HOOK_FILE_PATH"

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

python3 "$HOOK_DIR/../lib/command_guard.py" path "$FILE_PATH"
status=$?
if [[ $status -eq 0 ]]; then
  exit 0
fi
exit 2
