# 0001: dist is built outside the repository

## Status

Accepted.

## Context

The server serves a pre-built `dist/` directory, which is git-ignored. A build step inside this
repository would tie the server to one toolchain.

## Decision

`dist/` is populated externally and delivered to `packages/express-static-serve/dist/`. The
repository has no build step, and none is added without asking. The only post-build step is
`prepare-dist`, which writes compressed variants and checks the result. The served directory is a
parameter of `createApp()` only; there is no `DIST_DIR` variable.

## Consequences

- The server stays small and has no build dependencies.
- A missing `dist/` does not stop the server: it starts, the health check answers, and every other
  path is a 404 plus a startup warning.
- Delivery is the operator's job, so the shape checks (`verify-dist`, `check-csp`, the manifest)
  exist to catch a bad delivery.
- The variants are listed once at startup, so a changed `dist/` needs a reload or restart.

## See also

- [Architecture](../architecture.md) for the dist pipeline.
