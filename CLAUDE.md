# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Overview

App Drawer is a monorepo for Node-based applications. It currently contains a single package,
`express-static-serve`, which is an Express.js server that serves static assets with intelligent
compression negotiation and security headers.

## Architecture

### express-static-serve

- **Error pages:** `views/404.ejs` and `views/500.ejs` are rendered by the catch-all 404 handler and
  the final error-handling middleware in `server.js`. `app.set("verbose errors", ...)` controls
  whether `500.ejs` includes the error message and stack trace; it fails closed and is only enabled
  when `NODE_ENV=development`. The error is always logged server-side via `console.error`
  regardless of this setting.
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
  startup, so after changing `dist/` run `prepare-dist` and reload the PM2 workers. README section
  "Providing `dist/`" is the user-facing version.
- **Trust proxy:** `app.set("trust proxy", 1)` - the server expects exactly one reverse
  proxy/CDN hop in front of it. Update this if the deployment topology changes.

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

Other non-default project configuration:

- Both `package.json` files declare `engines.node` as `>=22.15.0`; `.nvmrc` pins Node 24.
- The root `npm test` runs every workspace's tests (`npm test --workspaces --if-present`).
  `npm run test:coverage --workspace=express-static-serve` prints a coverage report and fails
  below 95% lines, 90% branches, or 85% functions.
- `start:express-static-serve` and `stop:express-static-serve` use
  `packages/express-static-serve/ecosystem.config.js` (cluster mode, one worker per CPU) and stop
  the app by name, `express-static-serve`.

The `express-static-serve` tests create and remove their own `dist/` fixtures, so no pre-built
`dist/` is needed to run them.

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
  `braces` (all versions affected, no fix exists) remains in `npm audit`.
- **GitHub Actions policy:** Every `uses:` is pinned to a full commit SHA with its tag in a
  trailing comment (Dependabot updates both), and every workflow declares top-level `permissions:
  contents: read`, with wider grants only at job level. The long pinned lines exceed 100
  characters, which the YAML linter only warns about. `.github/workflows/ci.yml` runs `npm ci`,
  `test:coverage`, and `audit:signatures` on Node 22.15.0 and 24. `test/supply-chain.test.js`
  enforces the pinning, the permissions, Dependabot's `github-actions` entry, and `ci.yml`.
- **Linting scope:** `super-linter` runs with `VALIDATE_ALL_CODEBASE: false`, but still lints the
  full content of any changed file, not just changed lines.

## Coding and Commit Style Guidelines

When working within this repository, adhere to the following style and commit rules:

- **Code Style**
  - **Max Line Length:** 100 characters.
  - **Module System:** CommonJS (`require`/`module.exports`).
  - **Typography:** **NEVER** use en dashes (–) or em dashes (—). Use only standard hyphens (-).
- **Commit Safety:** Do not create commits automatically; only commit when explicitly instructed.
  Never suggest `git commit`.
- **Problem Resolution:** If unsure or if there is more than one way a task can be done, conduct
  surveys or Q&A.
- **Commit Messages:** Use past participles in commit messages (e.g., "Added", "Fixed", "Updated").
  For code refactoring, simplification, and formatting, a one-line commit message of "Refactored and
  Formatted code" is acceptable.
- **Documentation and Commit Messages:** Never use en dashes (–) or em dashes (—) in documentation
  or commit messages.

## AI/Agent Guidelines

When generating or reviewing code for this project, LLMs and Agents must adhere to the following
invariants:

* **Middleware Order:** Always maintain the prescribed middleware order: Helmet $\rightarrow$
  Morgan $\rightarrow$ routes $\rightarrow$ static files $\rightarrow$ 404 handler $\rightarrow$
  error handler.
* **Configuration:** Never introduce undocumented configuration changes or bypass security checks.
* **Process:** Trust the framework's guarantees, only validating at system boundaries (user input,
  external APIs).
* **Security:** Prioritize writing safe, secure, and correct code, avoiding common OWASP Top 10
  vulnerabilities.

## Claude Code Tooling Notes

- Hook commands in `.claude/settings.json` can use `$CLAUDE_PROJECT_DIR` to reference the repository
  root - no need for a `git rev-parse --show-toplevel` wrapper.
- `GET /` is the health check route and does not go through `setCustomCacheControl`. Verify
  Cache-Control/compression headers by requesting an actual file under `dist/`, not `/`.
