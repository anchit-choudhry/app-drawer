#!/usr/bin/env bash
# Blocks edits to any .env* file (gitignored, contain real secrets).
# .env.example is intentionally allowed.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-input.sh"
FILE_PATH="$HOOK_FILE_PATH"

BASENAME=$(basename -- "$FILE_PATH")

if [[ "$BASENAME" == .env* && "$BASENAME" != ".env.example" ]]; then
  echo "BLOCKED: '$FILE_PATH' is gitignored and contains real secrets." >&2
  echo "Edit .env.example instead, then copy to .env manually." >&2
  exit 2
fi

exit 0
