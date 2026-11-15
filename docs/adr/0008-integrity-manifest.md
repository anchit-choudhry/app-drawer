# 0008: The integrity manifest and what it does not protect against

## Status

Accepted.

## Context

`dist/` is delivered from outside. A partial copy, a stale variant, or a file edited by accident
should be noticed before it is served, and an operator needs a short name for the build that is
live.

## Decision

`precompress` writes `dist/.dist-manifest.json`, recording the SHA-256, size, and variants of every
source file. `verify-dist` fails on a missing manifest, a mismatch, a symlink, and a stray dot
entry. The server logs `Serving dist build <12 hex characters>`, the first 12 characters of the
manifest's SHA-256. A manifest that lists no files is rejected.

## Consequences

- It detects partial, stale, or accidental changes.
- It does not defend against someone who can also rewrite the manifest, and the documents say so.
- Symlinks are rejected before delivery because the server follows them at runtime.
- A `dist/` without a manifest still starts, and the server logs that files are served
  uncompressed.

## See also

- [Threat model](../threat-model.md), row 9.
