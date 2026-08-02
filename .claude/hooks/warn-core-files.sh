#!/usr/bin/env bash
# Prints a soft reminder when editing server.js, whose middleware order is a
# documented invariant (Helmet -> Morgan -> routes -> static files).
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
  echo "  After editing, run: node server.js (or npm run start:express-static-serve)"
fi

exit 0
