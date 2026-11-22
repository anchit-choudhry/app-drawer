#!/usr/bin/env bash
# Prints a soft reminder when editing a file of express-static-serve whose rules are documented
# invariants: server.js (middleware order: Helmet -> Morgan -> routes -> static files),
# ecosystem.config.js (kill_timeout must stay above SHUTDOWN_TIMEOUT_MS), and the modules that
# own headers, cache policy, configuration, the proxy setting, and the access log.
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

if [[ "$FILE_PATH" != *"express-static-serve"* ]]; then
  exit 0
fi

case "$BASENAME" in
server.js)
  emit_notice \
    "NOTICE: 'server.js' has a documented middleware-order invariant." \
    "  - Required order: Helmet -> Morgan -> routes -> static files (see AGENTS.md)." \
    "  - Do not bypass security headers or introduce undocumented config changes." \
    "  After editing, run: npm test (and start the server to confirm GET / returns UP)."
  ;;
ecosystem.config.js)
  emit_notice \
    "NOTICE: 'ecosystem.config.js' kill_timeout must exceed SHUTDOWN_TIMEOUT_MS in server.js." \
    "  - Otherwise PM2 SIGKILLs workers that are still draining in-flight requests." \
    "  After editing, run: npm test (test/ecosystem.test.js enforces this)."
  ;;
security-headers.js)
  emit_notice \
    "NOTICE: 'lib/security-headers.js' is the single home of CSP_DIRECTIVES." \
    "  - server.js and scripts/check-csp.js both read it, so they cannot drift." \
    "  - An intended header change needs the snapshot refreshed and its diff reviewed:" \
    "    UPDATE_SNAPSHOTS=1 npm test --workspace=express-static-serve \\" \
    "      -- test/response-headers.test.js"
  ;;
cache-policy.js)
  emit_notice \
    "NOTICE: 'lib/cache-policy.js' decides Cache-Control for every file (see ADR 0007)." \
    "  - HTML is no-cache, a hex-hashed name is immutable, the rest keeps the 2 hour policy." \
    "  After editing, run: npm test (test/cache-policy.test.js and the header snapshot cover it)."
  ;;
config.js)
  emit_notice \
    "NOTICE: 'lib/config.js' parses every environment variable, strictly and failing closed." \
    "  - A new variable needs lib/config.js, the README table, and AGENTS.md." \
    "  After editing, run: npm test (test/docs-drift.test.js enforces the README part)."
  ;;
trust-proxy.js)
  emit_notice \
    "NOTICE: 'trust-proxy.js' parses TRUST_PROXY, which defaults to 0 (no proxy trusted)." \
    "  - A value above the real hop count lets a visitor choose the logged client address." \
    "  - ecosystem.config.js validates with the same parser; keep them in step." \
    "  After editing, run: npm test."
  ;;
access-log.js)
  emit_notice \
    "NOTICE: 'lib/access-log.js' writes request text into the log." \
    "  - The JSON format must keep escaping control characters and line separators." \
    "  After editing, run: npm test (test/access-log.test.js)."
  ;;
esac

exit 0
