#!/usr/bin/env bash
# Blocks edits to any .env* file (gitignored, contain real secrets).
# .env.example is intentionally allowed. The name is compared in lower case, because the
# default macOS file system treats .ENV as the same file as .env.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
hook_require_parsed
FILE_PATH="$HOOK_FILE_PATH"

BASENAME=$(basename -- "$FILE_PATH" | tr '[:upper:]' '[:lower:]')

if [[ "$BASENAME" == .env* && "$BASENAME" != ".env.example" ]]; then
  echo "BLOCKED: '$FILE_PATH' is gitignored and contains real secrets." >&2
  echo "Edit .env.example instead, then copy to .env manually." >&2
  exit 2
fi

exit 0
