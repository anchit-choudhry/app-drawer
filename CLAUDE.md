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
- **Missing `dist/`:** the server still starts and `GET /` still reports `UP`; only the startup
  warning and 404s on every other path reveal a bad deploy.
- **Trust proxy:** `app.set("trust proxy", 1)` - the server expects exactly one reverse
  proxy/CDN hop in front of it. Update this if the deployment topology changes.

## Commands

The server requires a `dist/` directory inside `packages/express-static-serve/` to serve static
files. There is currently no build step in this repository; `dist/` is expected to be populated
externally.

Two helper scripts operate on a populated `dist/` (default: `packages/express-static-serve/dist`,
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
  `npm run test:coverage --workspace=express-static-serve` prints a coverage report.
- `start:express-static-serve` and `stop:express-static-serve` use
  `packages/express-static-serve/ecosystem.config.js` (cluster mode, one worker per CPU) and stop
  the app by name, `express-static-serve`.

The `express-static-serve` tests create and remove their own `dist/` fixtures, so no pre-built
`dist/` is needed to run them.

## CI/CD

### Security & Maintenance

- **Vulnerability Scanning:** Regularly run `npm audit`.
- **Fixing Vulnerabilities:** Use `npm audit fix`. Avoid `--force` to prevent breaking changes.
- **Lockfile integrity:** If `package-lock.json` is missing `resolved`/`integrity` fields, `npm
  install` alone won't fix it while `node_modules` still exists - remove both first.
- **Transitive vulnerability overrides:** The root `package.json` pins `js-yaml` to `4.3.2` via
  `overrides` because `pm2` pins an exact vulnerable `js-yaml@4.3.1` (GHSA-2883-xcg3-v3hh) and has
  no looser range to update into. This avoids `npm audit fix --force`, which would otherwise
  downgrade `pm2` from `7.0.4` to `5.3.1`. Remove the override once `pm2` bumps its own `js-yaml`
  dependency past `4.3.1`.
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
