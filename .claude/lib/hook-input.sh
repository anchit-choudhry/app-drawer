#!/usr/bin/env bash
# Shared helper: parses the PreToolUse/PostToolUse hook JSON payload that
# Claude Code delivers on stdin. Hooks in .claude/hooks/ used to read a
# CLAUDE_TOOL_INPUT env var instead - that var does not exist in the real
# contract, so every conditional hook silently no-op'd since it was written.
# Lives in .claude/lib/, not .claude/hooks/, because block-hook-edit.sh's glob
# only matches .claude/hooks/*.sh and .claude/settings.json, so this file can
# still be edited normally.
#
# Usage (source once, before reading anything else from stdin - this
# consumes stdin):
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
#   echo "$HOOK_COMMAND"      # tool_input.command (Bash calls)
#   echo "$HOOK_FILE_PATH"    # tool_input.file_path (Edit/Write calls)
#   echo "$HOOK_PROMPT"       # prompt (UserPromptSubmit calls)

# The HOOK_* variables are consumed by the hooks that source this file.
# shellcheck disable=SC2034
if [ -t 0 ]; then
  HOOK_INPUT_JSON=""
else
  HOOK_INPUT_JSON=$(cat)
fi

HOOK_COMMAND=$(printf '%s' "$HOOK_INPUT_JSON" | python3 -c "
import json, os, sys
json_str = (sys.stdin.read() or os.environ.get('GEMINI_TOOL_INPUT')
            or os.environ.get('CLAUDE_TOOL_INPUT') or '')
try:
    d = json.loads(json_str) if json_str else {}
except Exception:
    d = {}
print(d.get('tool_input', {}).get('command') or d.get('command') or '')
" 2>/dev/null || echo "")

HOOK_FILE_PATH=$(printf '%s' "$HOOK_INPUT_JSON" | python3 -c "
import json, os, sys
json_str = (sys.stdin.read() or os.environ.get('GEMINI_TOOL_INPUT')
            or os.environ.get('CLAUDE_TOOL_INPUT') or '')
try:
    d = json.loads(json_str) if json_str else {}
except Exception:
    d = {}
print(d.get('tool_input', {}).get('file_path') or d.get('file_path') or '')
" 2>/dev/null || echo "")

HOOK_PROMPT=$(printf '%s' "$HOOK_INPUT_JSON" | python3 -c "
import json, os, sys
json_str = (sys.stdin.read() or os.environ.get('GEMINI_TOOL_INPUT')
            or os.environ.get('CLAUDE_TOOL_INPUT') or '')
try:
    d = json.loads(json_str) if json_str else {}
except Exception:
    d = {}
print(d.get('prompt') or os.environ.get('GEMINI_USER_PROMPT_SUBMIT')
      or os.environ.get('CLAUDE_USER_PROMPT_SUBMIT') or '')
" 2>/dev/null || echo "")
