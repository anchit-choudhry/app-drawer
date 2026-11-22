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
- Dependencies updated, with their declared minimums raised to match: `ejs` 7.0.2,
  `supertest` 7.3.2, and `pm2` 7.1.2.
- The Trivy image in `container.yml` is pinned to 0.76.2 by digest.
- `release.yml` sets `package-manager-cache: false`, because `setup-node` turns caching on by
  itself, and the EditorConfig exemption for `package.json` now matches the file (found by
  super-linter, which now lints every file cleanly).

### Fixed

- Error pages no longer carry the headers of the file that failed (`Content-Encoding`,
  `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges`, `Content-Range`).
- `precompress` no longer writes through a symlink.
- The JSON access log escapes C1 control characters and line separators.
- A percent-encoded file extension (`app.abc123%2Ejs`) no longer answers with
  `Content-Type: false` next to the immutable cache policy: such a request is served without a
  compressed variant, so the type comes from the real file name.
- `check-csp` no longer slows down with the square or cube of the page on unclosed tags or
  comments, which could hang `prepare-dist` or a start with `VERIFY_DIST_ON_START=true`. A start
  tag it cannot parse is now reported as a finding instead of being skipped, and `<!-->`,
  `<!--->`, and `--!>` end a comment, so a script after them is no longer hidden from the lint.
- The 400 that a path with a bad escape gets is now `Cache-Control: no-store`, like every other
  error page.
- Shutdown no longer waits out a long `KEEP_ALIVE_TIMEOUT_MS` for a connection that was still
  sending a response when `server.close()` ran: idle connections are swept every 100 ms until the
  server has closed.

### Security

- Every GitHub Actions `uses:` and every registry image in a `run:` script is pinned by SHA or
  digest, every job has a timeout, and the base image is pinned by digest.
- The PM2 reload environment and the shutdown window are checked by tests.
- The Claude Code guard hooks parse commands in `.claude/lib/command_guard.py` instead of
  matching text: they now catch `git commit`, `rm`, and destructive git commands behind `;`
  without spaces, `bash -c`, `eval`, `$(...)`, `sudo`, `git -C`, `-uf`-style flags, and a
  preceding `cd`, and they fail closed when `python3` is missing or the payload is not JSON.
  `block-hook-edit.sh` also protects `.claude/lib/`, `settings.local.json`, and mixed-case paths.
- `release.yml` refuses a tag whose commit is not on `main` and no longer uses the npm cache in
  the job that holds a write token.
- The docs run PM2 with `npx --no-install`, and the Docker example adds
  `--security-opt=no-new-privileges`, as the container workflow does.

## See also

- [README](README.md) for the settings, and [AGENTS.md](AGENTS.md) for the invariants.
