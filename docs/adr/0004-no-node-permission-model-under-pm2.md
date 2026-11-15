# 0004: No Node permission model under PM2

## Status

Accepted.

## Context

Node's `--permission` flag restricts what a process may touch, which suits a static server. It was
tried with PM2 7.0.4 and 7.1.1 in cluster mode (checked on both): the workers crash at startup
with `ERR_ACCESS_DENIED` for the inspector API. `--allow-inspector` removes the error, but it lets
a worker bypass the restrictions the model is meant to enforce.

## Decision

`node_args` in `ecosystem.config.js` is `--disable-proto=delete` only. `--permission` and
`--allow-inspector` are not used. `test/ecosystem.test.js` enforces this, and
`test/runtime-hardening.test.js` boots the server with these exact flags.

## Consequences

- Prototype pollution is still mitigated by `--disable-proto=delete`.
- File access is not restricted at the process level under PM2. The Docker image compensates with
  a non-root user, a read-only file system, and no capabilities.
- The decision is worth revisiting when a PM2 release supports the permission model in cluster
  mode.

## See also

- [Decision 0005](0005-docker-image-runs-plain-node.md) for the container.
