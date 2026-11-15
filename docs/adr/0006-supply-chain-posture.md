# 0006: Supply-chain posture

## Status

Accepted.

## Context

A dependency or a CI action that is compromised after release is a common way in. Install scripts
run code at install time, and a mutable tag can change under a pinned reference.

## Decision

- The root `.npmrc` sets `ignore-scripts=true`, `engine-strict=true`, and `min-release-age=7`.
- `packageManager` pins npm with an integrity hash, and the lockfile resolves only from the public
  registry with integrity hashes and no git, file, or URL specs.
- `npm run audit:signatures` verifies registry signatures and provenance attestations in CI.
- Every `uses:` in a workflow is pinned to a full commit SHA, every workflow declares
  `contents: read` at the top, every job has a timeout, and no `run:` script contains a
  `${{ }}` expression.
- Every registry image in a `run:` script, and the base image, is pinned by digest.
- Dependabot waits 7 days before proposing a version, matching `min-release-age`.

## Consequences

- A package that genuinely needs an install script is run explicitly with
  `npm rebuild <pkg> --ignore-scripts=false`.
- Urgent security fixes can use `--min-release-age=0` for one command.
- The Trivy image in `container.yml` is updated by hand, because Dependabot does not see it.
- `test/supply-chain.test.js` enforces the rules.

## See also

- [Threat model](../threat-model.md), rows 14 and 15.
