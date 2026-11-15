# 0002: GET / is the health check and there is no SPA fallback

## Status

Accepted.

## Context

A load balancer or container platform needs a cheap URL that answers while the process is alive,
even when `dist/` is missing. A static site also needs a clear rule for unknown paths.

## Decision

`GET /` returns `{ "status": "UP" }` with `Cache-Control: no-store`, and `503` with
`{ "status": "DRAINING" }` while the server shuts down. The root `index.html` is therefore
reachable at `/index.html`, and a subfolder serves its own at `/sub/`. Unknown paths return the
404 page. There is no single-page-app fallback to `index.html`.

## Consequences

- A health check never depends on the content of `dist/`, so it cannot report a bad deploy; only
  the startup warning and the 404s do.
- Every route of a site needs a real file, or the site uses hash-based routing.
- A CDN cannot keep an old health answer, because of `no-store`.
- `SHUTDOWN_GRACE_MS` lets a balancer see the `503` before the socket closes.

## See also

- [Runbook](../runbook.md) for the symptoms this produces.
