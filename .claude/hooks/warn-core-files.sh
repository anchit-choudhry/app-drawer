#!/usr/bin/env bash
# Prints a soft reminder when editing server.js, whose middleware order is a
# documented invariant (Helmet -> Morgan -> routes -> static files), or
# ecosystem.config.js, whose kill_timeout must stay above server.js's SHUTDOWN_TIMEOUT_MS.
# Does NOT block (exit 0) - informational only.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
FILE_PATH="$HOOK_FILE_PATH"

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

BASENAME=$(basename -- "$FILE_PATH")

# Claude never sees stdout or stderr from a PreToolUse hook that exits 0. Returning the
# reminder as additionalContext puts it in front of Claude without changing the permission
# decision.
emit_notice() {
  python3 -c '
import json, sys
text = "\n".join(sys.argv[1:])
output = {"hookEventName": "PreToolUse", "additionalContext": text}
print(json.dumps({"hookSpecificOutput": output}))
' "$@"
}

if [[ "$BASENAME" == "server.js" ]] && [[ "$FILE_PATH" == *"express-static-serve"* ]]; then
  emit_notice \
    "NOTICE: 'server.js' has a documented middleware-order invariant." \
    "  - Required order: Helmet -> Morgan -> routes -> static files (see CLAUDE.md)." \
    "  - Do not bypass security headers or introduce undocumented config changes." \
    "  After editing, run: npm test (and start the server to confirm GET / returns UP)."
elif [[ "$BASENAME" == "ecosystem.config.js" ]] &&
  [[ "$FILE_PATH" == *"express-static-serve"* ]]; then
  emit_notice \
    "NOTICE: 'ecosystem.config.js' kill_timeout must exceed SHUTDOWN_TIMEOUT_MS in server.js." \
    "  - Otherwise PM2 SIGKILLs workers that are still draining in-flight requests." \
    "  After editing, run: npm test (test/ecosystem.test.js enforces this)."
fi

exit 0
