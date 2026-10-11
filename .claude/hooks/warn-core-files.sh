#!/usr/bin/env bash
# Prints a soft reminder when editing server.js, whose middleware order is a
# documented invariant (Helmet -> Morgan -> routes -> static files), or
# ecosystem.config.js, whose kill_timeout must stay above server.js's SHUTDOWN_TIMEOUT_MS.
# Does NOT block (exit 0) - informational only.
set -uo pipefail

FILE_PATH=$(python3 -c "
import json, os
d = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
print(d.get('file_path', ''))
" 2>/dev/null || echo "")

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

BASENAME=$(basename -- "$FILE_PATH")

if [[ "$BASENAME" == "server.js" ]] && [[ "$FILE_PATH" == *"express-static-serve"* ]]; then
  echo "NOTICE: 'server.js' has a documented middleware-order invariant."
  echo "  - Required order: Helmet -> Morgan -> routes -> static files (see CLAUDE.md)."
  echo "  - Do not bypass security headers or introduce undocumented config changes."
  echo "  After editing, run: npm test (and start the server to confirm GET / returns UP)."
elif [[ "$BASENAME" == "ecosystem.config.js" ]] &&
  [[ "$FILE_PATH" == *"express-static-serve"* ]]; then
  echo "NOTICE: 'ecosystem.config.js' kill_timeout must exceed SHUTDOWN_TIMEOUT_MS in server.js."
  echo "  - Otherwise PM2 SIGKILLs workers that are still draining in-flight requests."
  echo "  After editing, run: npm test (test/ecosystem.test.js enforces this)."
fi

exit 0
