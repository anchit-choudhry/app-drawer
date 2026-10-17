# Express Security Reviewer

This agent mirrors the functionality defined in `.claude/agents/express-security-reviewer.md`.

Please refer to [.claude/agents/express-security-reviewer.md][full] for the full review criteria
and invariants.

## Summary of Invariants

1. **Middleware order**: Helmet -> Morgan -> routes -> static files -> 404 handler -> error
   handler.
2. **Configuration changes**: No undocumented env vars or weakened Helmet headers.
3. **Compression order**: Zstandard -> Brotli -> Gzip -> Deflate.
4. **Cache-Control**: Public, 2h client, 4h proxy, must-revalidate.
5. **Boundary validation**: Only at real system boundaries.
6. **Error handling**: Verbose errors fail closed (only when `NODE_ENV=development`); errors are
   always logged server-side.
7. **PM2 shutdown window**: `kill_timeout` in `ecosystem.config.js` stays above
   `SHUTDOWN_TIMEOUT_MS` in `server.js`.
8. **PM2 worker flags**: `node_args` stays `--disable-proto=delete` only (no `--permission`, no
   `--allow-inspector`).
9. **Trust proxy and health check**: `trust proxy` stays `1`; `GET /` stays the health check and
   unknown paths still return the 404 page.

[full]: ../../.claude/agents/express-security-reviewer.md
