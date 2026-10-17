#!/usr/bin/env bash
# Hard-blocks Edit/Write on the security-enforcement files themselves:
# .claude/settings.json and .claude/hooks/*.sh.
# These must only be changed by the user directly, in their own editor -
# never via the Edit/Write tool. This closes the gap where a compromised or
# prompt-injected agent could quietly weaken its own guardrails. Intentional
# tradeoff: the assistant must describe the exact change and the user applies
# it manually; see CLAUDE.md's "Claude Code Tooling Notes" section.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
FILE_PATH="$HOOK_FILE_PATH"

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" == *"/.claude/settings.json" ]] ||
  { [[ "$FILE_PATH" == *"/.claude/hooks/"* ]] && [[ "$FILE_PATH" == *.sh ]]; } ||
  [[ "$FILE_PATH" == *"/.gemini/settings.json" ]] ||
  { [[ "$FILE_PATH" == *"/.gemini/hooks/"* ]] && [[ "$FILE_PATH" == *.sh ]]; }; then
  echo "BLOCKED: '$FILE_PATH' is a security-enforcement file." >&2
  echo "Edit/Write on settings.json and hooks/*.sh is not allowed." >&2
  echo "Describe the exact change needed; the user must apply it themselves." >&2
  exit 2
fi

exit 0
