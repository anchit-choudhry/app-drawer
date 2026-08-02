#!/usr/bin/env bash
# Blocks edits to .env / .env.local (gitignored, contain real secrets).
# .env.example is intentionally allowed.
set -euo pipefail

FILE_PATH=$(python3 -c "
import json, os, sys
d = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
print(d.get('file_path', ''))
" 2>/dev/null || echo "")

BASENAME=$(basename -- "$FILE_PATH")

if [[ "$BASENAME" == ".env" || "$BASENAME" == ".env.local" ]]; then
  echo "BLOCKED: '$FILE_PATH' is gitignored and contains real secrets."
  echo "Edit .env.example instead, then copy to .env manually."
  exit 2
fi

exit 0
