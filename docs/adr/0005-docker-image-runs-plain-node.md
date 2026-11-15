# 0005: The Docker image runs plain node, without PM2

## Status

Accepted.

## Context

PM2 cluster mode starts one worker per CPU and restarts them. A container platform already owns
replicas, restarts, and health checks, so a process manager inside the container duplicates it and
adds a large dependency tree.

## Decision

The `Dockerfile` runs `node --disable-proto=delete` on `server.js` directly, as the non-root
`node` user, on the Node major in `.nvmrc`, with the base image pinned by digest. The install step
reads only the workspace, so PM2 (a dependency of the repository root) is not in the image.
`dist/` is mounted at runtime and never copied in, which keeps the external `dist/` contract.

## Consequences

- One process per container; more capacity means more containers.
- A smaller image and fewer packages to audit.
- Dependabot's `docker` entry proposes new digests, and `container.yml` builds the image, runs it
  read-only with no capabilities, smoke-tests it, and scans it with Trivy.
- `test/container-image.test.js` enforces the digest pin, the copied modules, the non-root user,
  and that `dist/` is never copied.

## See also

- [Decision 0004](0004-no-node-permission-model-under-pm2.md) for the shared flag.
