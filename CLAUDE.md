# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Overview

App Drawer is a monorepo for Node-based applications. It currently contains a single package,
`express-static-serve`, which is an Express.js server that serves static assets with intelligent
compression negotiation and security headers.

## Layout

- `packages/express-static-serve/`: the only package. `server.js` (app and startup),
  `trust-proxy.js` (`TRUST_PROXY` parser), `ecosystem.config.js` (PM2), `scripts/` (dist
  tooling), `views/` (404/500), `test/`.
- `.claude/`: hooks, skills, agents, rules. `.gemini/` and `GEMINI.md` mirror this file for
  Gemini CLI; keep them in sync when invariants change.
- `.github/`: workflows, Dependabot, labeler, issue templates, `SECURITY.md`.
- `docs/superpowers/`: design specs and implementation plans for larger changes.

## Architecture

### express-static-serve

- **Error pages:** `views/404.ejs` and `views/500.ejs` are rendered by the catch-all 404 handler and
  the final error-handling middleware in `server.js`. `app.set("verbose errors", ...)` controls
  whether `500.ejs` includes the error message and stack trace; it fails closed and is only enabled
  when `NODE_ENV=development`. The error is always logged server-side via `console.error`
  regardless of this setting. PM2 starts workers with `NODE_ENV=production` (the `env` block in
  `ecosystem.config.js`), so details show only under `NODE_ENV=development node server.js`, or
  after a reload by app name with `--update-env` from a shell that exports it (README section
  "Running under PM2").
- **PM2 shutdown window:** `ecosystem.config.js` `kill_timeout` must stay above
  `SHUTDOWN_TIMEOUT_MS` in `server.js`, otherwise PM2 SIGKILLs workers that are still draining
  requests. `test/ecosystem.test.js` enforces this.
- **PM2 worker flags:** `node_args` in `ecosystem.config.js` is `--disable-proto=delete` only. Do
  not add `--permission`: PM2 7.0.4 cluster workers crash at startup with `ERR_ACCESS_DENIED` for
  the inspector API, and `--allow-inspector` would let a worker bypass the model's restrictions.
  `test/ecosystem.test.js` enforces this, and `test/runtime-hardening.test.js` boots the server
  with these exact flags.
- **Missing `dist/`:** the server still starts and `GET /` still reports `UP`; only the startup
  warning and 404s on every other path reveal a bad deploy. Startup problems are reported by PM2
  instance 0 only (`NODE_APP_INSTANCE`), so a cluster logs them once. Set
  `VERIFY_DIST_ON_START=true` to also run the full `verify-dist` check at boot; it logs each
  problem as a warning and never stops the server. It is off by default because it reads and
  decompresses every variant.
- **`dist/` contract:** `dist/` is git-ignored and built outside this repo by design, so do not
  add a build step without asking. `GET /` is the health check, so the root `index.html` is only
  reachable at `/index.html` (a subfolder serves its own at `/sub/`), and there is no SPA fallback:
  unknown paths return the 404 page. `express-static-gzip` lists compressed variants once at
  startup, so after changing `dist/` run `prepare-dist` and reload the PM2 workers from the
  ecosystem file (never by app name with `--update-env`; README section "Running under PM2").
  README section "Providing `dist/`" is the user-facing version.
- **Trust proxy:** `app.set("trust proxy", ...)` takes the `TRUST_PROXY` environment variable,
  parsed by `parseTrustProxy` in `trust-proxy.js`. It defaults to `0` (no proxy trusted); set `1`
  for exactly one reverse proxy/CDN hop. Only an unset or empty value, or a whole number from 0 to
  10, is accepted; anything else (`true`, `loopback`, spaces, larger numbers) throws. `server.js`
  and `ecosystem.config.js` both parse it, so a bad value stops `pm2 start` and a reload from the
  ecosystem file before any worker changes. Anything else that loads `server.js` or
  `ecosystem.config.js` in a shell with a bad value fails the same way; the tests clear the
  variable themselves. Only the Morgan access log reads the client IP.

## Commands

The server requires a `dist/` directory inside `packages/express-static-serve/` to serve static
files. There is currently no build step in this repository; `dist/` is expected to be populated
externally (a deliberate decision, see the `dist/` contract above).

Three helper scripts operate on a populated `dist/` (default: `packages/express-static-serve/dist`,
or pass a directory), run via `npm run <script> --workspace=express-static-serve`:

- `precompress` writes the `.zst`/`.br`/`.gz`/`.zz` variants the server negotiates. Re-run it after
  every `dist/` change: a stale variant is served instead of the current file. What gets
  compressed is tuned in `scripts/compression-policy.js`.
- `verify-dist` fails on a missing `index.html`, orphaned variants, or variants that no longer
  match their source.
- `prepare-dist` runs `precompress` and then `verify-dist`; use it as the single post-build step.

All three need Node 22.15+ (`zlib.zstdCompressSync`).

Run and test:

- `node packages/express-static-serve/server.js` starts one process on `PORT` (default 3000).
  `PORT`, `NODE_ENV`, `TRUST_PROXY`, and `VERIFY_DIST_ON_START` are tabled in the README.
- `npm run logs:express-static-serve` shows the PM2 logs.
- One test file: `node --test packages/express-static-serve/test/server.test.js`.

Other non-default project configuration:

- Both `package.json` files declare `engines.node` as `>=22.15.0`; `.nvmrc` pins Node 24.
- The root `npm test` runs every workspace's tests (`npm test --workspaces --if-present`).
  `npm run test:coverage --workspace=express-static-serve` prints a coverage report and fails
  below 95% lines, 90% branches, or 85% functions.
- `start:express-static-serve` and `stop:express-static-serve` use
  `packages/express-static-serve/ecosystem.config.js` (cluster mode, one worker per CPU) and stop
  the app by name, `express-static-serve`.

The `express-static-serve` tests create and remove their own `dist/` fixtures, so no pre-built
`dist/` is needed to run them. The test files share those fixtures, so run them through
`npm test`, which passes `--test-concurrency=1`; a bare concurrent `node --test` races. A leftover
`dist/` (for example from a crashed run) makes the startup, runtime-hardening, and `prepare-dist`
default tests skip silently, so delete it if the skipped count is not 0.

## CI/CD

### Security & Maintenance

- **Vulnerability Scanning:** Regularly run `npm audit`.
- **Fixing Vulnerabilities:** Use `npm audit fix`. Avoid `--force` to prevent breaking changes.
- **npm hardening:** The root `.npmrc` sets `ignore-scripts=true` (dependency install scripts
  never run; if a package genuinely needs one, run it explicitly with `npm rebuild <pkg>
  --ignore-scripts=false`), `engine-strict=true` (installs fail outside the `engines` range), and
  `min-release-age=7` (npm resolves only versions published at least 7 days ago; versions already
  in the lockfile are unaffected, and `npm update <pkg> --min-release-age=0` adopts a fix sooner).
  `packageManager` pins npm with an integrity hash.
  `npm run audit:signatures` verifies registry signatures and provenance attestations.
  `test/supply-chain.test.js` enforces both settings, plus that the lockfile only resolves from
  `https://registry.npmjs.org/` with integrity hashes and no git, file, or URL dependency specs.
- **Lockfile integrity:** If `package-lock.json` is missing `resolved`/`integrity` fields, `npm
  install` alone won't fix it while `node_modules` still exists - remove both first.
- **Transitive vulnerability overrides:** The root `package.json` pins `js-yaml` to `4.3.2` via
  `overrides` because `pm2` pins an exact vulnerable `js-yaml@4.3.1` (GHSA-2883-xcg3-v3hh) and has
  no looser range to update into. This avoids `npm audit fix --force`, which would otherwise
  downgrade `pm2` from `7.0.4` to `5.3.1`. Remove the override once `pm2` bumps its own `js-yaml`
  dependency past `4.3.1`. The same file pins `basic-ftp` to `6.2.1`, the first release outside its
  vulnerable range (`<=6.2.0`), which `pm2` reaches through `proxy-agent` and `get-uri` (declared as
  `^5.0.2`); that chain only uses it for `ftp:` proxy-config URLs. Remove it once `get-uri` allows a
  fixed version. After changing an override, apply it with `npm update <pkg>`; deleting the
  package's lockfile entry instead leaves it uninstalled and breaks `require("get-uri")`.
  `braces` (all versions affected, no fix exists) is still installed through `pm2`; `npm audit`
  stopped reporting it on 2026-10-24, but the Trivy and OSV exceptions stay until re-reviewed.
- **GitHub Actions policy:** Every `uses:` is pinned to a full commit SHA with its tag in a
  trailing comment (Dependabot updates both), and every workflow declares top-level `permissions:
  contents: read`, with wider grants only at job level. The long pinned lines exceed 100
  characters, which the YAML linter only warns about. `.github/workflows/ci.yml` runs `npm ci`,
  `test:coverage`, and `audit:signatures` on Node 22.15.0 and 24, under a `concurrency` group that
  cancels superseded pull request runs but never a run on `main`. `njsscan.yml` no longer ends in
  `|| true`, so its findings fail the job. Every `actions/checkout` sets
  `persist-credentials: false`, and no `run:` script may contain a `${{ }}` expression: event
  fields and step outputs (an issue body, a model's reply) can be attacker-controlled, so pass
  them through `env:` and quote the variable. Dependabot waits 7 days (`cooldown`) before
  proposing a version, matching `min-release-age`. `test/supply-chain.test.js` enforces the
  pinning, the permissions, both checkout and `run:` rules, Dependabot's `github-actions` entry,
  and `ci.yml`.
- **Linting scope:** `super-linter` (the `super-linter/super-linter/slim` action, pinned to a
  SHA like every other action) runs with `VALIDATE_ALL_CODEBASE: false`, but still lints the full
  content of any changed file, not just changed lines.
- **Linter config:** each linter reads a fixed file name from `.github/linters/`:
  `.markdown-lint.yml` (not `.markdownlint.yml`, which super-linter silently ignores),
  `.editorconfig-checker.json`, `.jscpd.json`, `.textlintrc`, `.codespellrc`, `.yaml-lint.yml`,
  and `zizmor.yaml`. Prettier reads the root `.prettierrc.json` and `.prettierignore` (Markdown is
  ignored there). Biome is switched off in the workflow because it conflicts with Prettier and
  ESLint; setting `VALIDATE_<LINTER>: false` only disables that one. `.trivyignore` holds the
  expiring `braces` exception (no fixed release exists); remove it once one is published.
- **Run super-linter locally:** it needs Docker, an `amd64` image, and a clean tree because it
  reads tracked files only, so stage new files first (`git add -N`) or add
  `-e USE_FIND_ALGORITHM=true`, which cannot be combined with `DEFAULT_BRANCH`:

  ```bash
  docker run --rm --platform linux/amd64 -e RUN_LOCAL=true -e VALIDATE_ALL_CODEBASE=true \
    -e IGNORE_GITIGNORED_FILES=true -e VALIDATE_BIOME_FORMAT=false -e VALIDATE_BIOME_LINT=false \
    -v "$PWD":/tmp/lint ghcr.io/super-linter/super-linter:slim-v9.0.0
  ```

  Trivy unpacks a vulnerability database of about 1 GB inside the container. If Docker's disk is
  nearly full it fails with `no space left on device` and no findings; mount a host directory at
  `/github/home/.cache/trivy` (`-v "$PWD/.tmp-trivy-cache":/github/home/.cache/trivy`) and delete
  it afterwards.

## Coding and Commit Style Guidelines

When working within this repository, adhere to the following style and commit rules:

- **Code Style**
  - **Max Line Length:** 100 characters.
  - **Module System:** CommonJS (`require`/`module.exports`).
  - **Typography:** **NEVER** use en dashes (–) or em dashes (—) in code, documentation, or
    commit messages. Use only standard hyphens (-).
- **Commit Safety:** Do not create commits automatically; only commit when explicitly instructed.
  Never suggest `git commit`.
- **Problem Resolution:** If unsure or if there is more than one way a task can be done, conduct
  surveys or Q&A.
- **Commit Messages:** Use past participles in commit messages (e.g., "Added", "Fixed", "Updated").
  For code refactoring, simplification, and formatting, a one-line commit message of "Refactored and
  Formatted code" is acceptable.

## AI/Agent Guidelines

When generating or reviewing code for this project, LLMs and Agents must adhere to the following
invariants:

* **Middleware Order:** Always maintain the prescribed middleware order: Helmet -> Morgan ->
  routes -> static files -> 404 handler -> error handler.
* **Configuration:** Never introduce undocumented configuration changes or bypass security checks.
* **Process:** Trust the framework's guarantees, only validating at system boundaries (user input,
  external APIs).
* **Security:** Prioritize writing safe, secure, and correct code, avoiding common OWASP Top 10
  vulnerabilities.

## Claude Code Tooling Notes

- Hook commands in `.claude/settings.json` can use `$CLAUDE_PROJECT_DIR` to reference the repository
  root - no need for a `git rev-parse --show-toplevel` wrapper.
- Verify Cache-Control/compression headers by requesting a real file under `dist/`; `GET /`
  bypasses `setCustomCacheControl` and sets its own `Cache-Control: no-store`.
- **Hook input:** hooks read the PreToolUse JSON from stdin through `.claude/lib/hook-input.sh`
  (`HOOK_COMMAND`, `HOOK_FILE_PATH`). Never read `CLAUDE_TOOL_INPUT`: Claude Code does not set it,
  so a hook that does is a silent no-op. Block messages go to stderr with exit 2. Test a hook by
  piping JSON into it. Hooks match against the whole command text, so a command that merely
  mentions a blocked pattern (for example in an `echo`) is blocked too. Claude never sees stdout
  or stderr from a PreToolUse hook that exits 0, so a reminder (`warn-core-files.sh`) is printed
  as JSON with `hookSpecificOutput.additionalContext` instead.
- **Protected files:** `block-hook-edit.sh` blocks Edit/Write on `.claude/settings.json`,
  `.gemini/settings.json`, and `hooks/*.sh`. Describe the exact change and the user applies it;
  `.claude/lib/` is deliberately outside that glob. `block-git-commit.sh` likewise blocks
  `git commit` from the session, which enforces Commit Safety above. For pending changes to those
  files, `node .claude/lib/apply-hardening.js` (add `--dry-run` to preview) applies them
  idempotently and verifies the result; extend its steps instead of hand-editing the hooks.
- **Personal sound hook:** `.claude/hooks/notification-alert.sh` plays a macOS sound on
  notifications. It is git-ignored and registered in the git-ignored `.claude/settings.local.json`,
  not in the shared `settings.json`; the same script step creates that registration.
- **Skills, agents, rules:** skills `dependency-update`, `owasp-security-audit`, and
  `web-security-audit`; agent `express-security-reviewer` (run it after editing `server.js`);
  `.claude/rules/markdown.md` is the Markdown style rule, adapted to the markdownlint config.
