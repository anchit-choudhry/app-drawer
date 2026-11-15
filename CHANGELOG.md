# Changelog

All notable changes to this project are recorded here, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) layout.

## Unreleased

### Added

- `lib/` modules for configuration, security headers, cache policy, and the access log.
- `LOG_FORMAT` (`combined` or `json`), `LOG_HEALTH_CHECKS`, `KEEP_ALIVE_TIMEOUT_MS`,
  `HEADERS_TIMEOUT_MS`, and `SHUTDOWN_GRACE_MS`, all parsed strictly.
- A `503` `DRAINING` health answer during shutdown.
- An integrity manifest written by `precompress`, and the build id in the startup log.
- `check-csp`, a lint of the HTML in `dist/` against the Content-Security-Policy.
- A `Permissions-Policy` header, and `/.well-known/` served without compressed variants.
- Container, release, and OpenSSF Scorecard workflows, and a locked-down Docker run.
- Architecture, threat model, runbook, and decision records under `docs/`, and `AGENTS.md` as the
  shared guidance for coding agents.
- Contributing guide, code owners, a pull request template, and issue forms.

### Changed

- `PORT` and `VERIFY_DIST_ON_START` are parsed strictly: a value that is not accepted stops the
  server at startup instead of falling back.
- HTML is served with `Cache-Control: no-cache`, hex-hashed files are `immutable`, and a response
  with no policy of its own is `no-cache`.
- `verify-dist` fails when there is no manifest, and on a symlink or a stray dot entry.
- `prepare-dist` runs `precompress`, `verify-dist`, and `check-csp`, and fails on any CSP finding.
- Any method other than GET and HEAD answers 405 with `Allow: GET, HEAD`.
- PM2 moved to the root `package.json`, and the Docker image no longer contains it.
- `CLAUDE.md` and `GEMINI.md` import `AGENTS.md`.

### Fixed

- Error pages no longer carry the headers of the file that failed (`Content-Encoding`,
  `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges`, `Content-Range`).
- `precompress` no longer writes through a symlink.
- The JSON access log escapes C1 control characters and line separators.

### Security

- Every GitHub Actions `uses:` and every registry image in a `run:` script is pinned by SHA or
  digest, every job has a timeout, and the base image is pinned by digest.
- The PM2 reload environment and the shutdown window are checked by tests.

## See also

- [README](README.md) for the settings, and [AGENTS.md](AGENTS.md) for the invariants.
