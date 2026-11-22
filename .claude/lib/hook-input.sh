#!/usr/bin/env bash
# Shared helper: parses the PreToolUse/PostToolUse hook JSON payload that
# Claude Code delivers on stdin. Hooks in .claude/hooks/ used to read a
# CLAUDE_TOOL_INPUT env var instead - that var does not exist in the real
# contract, so every conditional hook silently no-op'd since it was written.
# Protected like the hooks: block-hook-edit.sh blocks Edit/Write on everything
# under .claude/lib/, because every hook sources this file and a change here
# can switch all of them off.
#
# Usage (source once, before reading anything else from stdin - this
# consumes stdin):
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
#   hook_require_parsed       # guard hooks: block when the payload could not be read
#   echo "$HOOK_COMMAND"      # tool_input.command (Bash calls)
#   echo "$HOOK_FILE_PATH"    # tool_input.file_path (Edit/Write calls)
#   echo "$HOOK_PROMPT"       # prompt (UserPromptSubmit calls)
#
# HOOK_PARSE_OK is 0 when python3 is missing or the payload is not JSON. An
# empty payload (a hook run by hand) is fine and gives empty values.

# The HOOK_* variables are consumed by the hooks that source this file.
# shellcheck disable=SC2034
HOOK_PARSE_OK=1
if [ -t 0 ]; then
  HOOK_INPUT_JSON=""
else
  HOOK_INPUT_JSON=$(cat)
fi

# Prints one field of the payload. Exits 3 when the payload is not valid JSON;
# the shell itself exits 127 when python3 is missing. Either way the caller
# sees a failure instead of an empty value that looks like "nothing to check".
_hook_field() {
  printf '%s' "$HOOK_INPUT_JSON" | python3 -c '
import json, os, sys
field = sys.argv[1]
raw = (sys.stdin.read() or os.environ.get("GEMINI_TOOL_INPUT")
       or os.environ.get("CLAUDE_TOOL_INPUT") or "")
try:
    data = json.loads(raw) if raw else {}
except Exception:
    sys.exit(3)
if not isinstance(data, dict):
    sys.exit(3)
tool_input = data.get("tool_input")
if not isinstance(tool_input, dict):
    tool_input = {}
if field == "prompt":
    print(data.get("prompt") or os.environ.get("GEMINI_USER_PROMPT_SUBMIT")
          or os.environ.get("CLAUDE_USER_PROMPT_SUBMIT") or "")
else:
    print(tool_input.get(field) or data.get(field) or "")
' "$1"
}

HOOK_COMMAND=$(_hook_field command) || HOOK_PARSE_OK=0
HOOK_FILE_PATH=$(_hook_field file_path) || HOOK_PARSE_OK=0
HOOK_PROMPT=$(_hook_field prompt) || HOOK_PARSE_OK=0

# Guard hooks call this first. A hook that cannot read its input must block:
# exiting 0 would let a broken parser switch the guard off without a sound.
hook_require_parsed() {
  if [ "$HOOK_PARSE_OK" != "1" ]; then
    echo "BLOCKED: this guard hook could not read its input (python3 is missing, or the" >&2
    echo "payload is not JSON). Hooks fail closed so that a broken parser cannot turn a" >&2
    echo "guard off. Make sure python3 is on PATH." >&2
    exit 2
  fi
}
