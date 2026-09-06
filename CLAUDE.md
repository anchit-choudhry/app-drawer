# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Overview

App Drawer is a monorepo for Node-based applications. It currently contains a single package,
`express-static-serve`, which is an Express.js server that serves static assets with intelligent
compression negotiation and security headers.

## Architecture

### Monorepo Structure

Uses npm workspaces (`packages/*`):

```text
app-drawer/
├── packages/
│   └── express-static-serve/    # Express server package
│       ├── server.js            # Main entry point
│       ├── package.json
│       └── views/               # EJS templates for 404/500 error pages
├── package.json                 # Root workspace config
├── .claude/                     # Claude Code hooks, agents, and skills for this repository
└── .github/                     # CI/CD workflows and Dependabot config
```

### express-static-serve

- **Port:** Defaults to `3000`, overridable via the `PORT` environment variable.
- **Modules:** CommonJS (`type: "commonjs"`)
- **Static assets:** Served from `dist/` (must be pre-built) via `express-static-gzip`.
  Pre-compressed variants are matched by file extension: `.zst` (Zstandard), `.br` (Brotli), `.gz`
  (Gzip), `.zz`
  (Deflate). Uncompressed files are served as-is if no matching variant exists.
- **Compression negotiation order:** Zstandard → Brotli → Gzip → Deflate
- **Cache-Control:** Public, 2-hour client max-age, 4-hour proxy s-maxage, must-revalidate,
  proxy-revalidate
- **Middleware order:** Helmet (security headers) → Morgan (logging) → routes → static files → 404
  handler → error handler
- **Error pages:** `views/404.ejs` and `views/500.ejs` are rendered by the catch-all 404 handler and
  the final error-handling middleware in `server.js`. `app.set("verbose errors", ...)` controls
  whether `500.ejs` includes the error message and stack trace; it fails closed and is only enabled
  when `NODE_ENV=development`. The error is always logged server-side via `console.error`
  regardless of this setting.
- **Health check:** `GET /` returns `{ status: "UP" }`
- **Trust proxy:** `app.set("trust proxy", 1)` - the server expects exactly one reverse
  proxy/CDN hop in front of it. Update this if the deployment topology changes.
- **Graceful shutdown:** `SIGTERM`/`SIGINT` close the HTTP server cleanly, with a 10-second forced
  exit fallback, so PM2 cluster reloads don't drop in-flight requests.
- **Process manager:** PM2 in cluster mode, auto-scales to CPU count (`-i 0`)

## Commands

All scripts are defined at the root level and delegate to PM2:

```bash
npm run start:express-static-serve   # Start server via PM2 (cluster mode)
npm run stop:express-static-serve    # Stop PM2 process
npm run logs:express-static-serve    # Stream PM2 logs
```

For direct local development without PM2:

```bash
cd packages/express-static-serve && node server.js
```

The server requires a `dist/` directory inside `packages/express-static-serve/` to serve static
files. There is currently no build step in this repository; `dist/` is expected to be populated
externally.

To run the `express-static-serve` test suite (Node's built-in test runner + supertest; tests
create and remove their own `dist/` fixtures, so no pre-built `dist/` is needed):

```bash
npm test --workspace=express-static-serve
```

## CI/CD

### Security & Maintenance

- **Vulnerability Scanning:** Regularly run `npm audit`.
- **Fixing Vulnerabilities:** Use `npm audit fix`. Avoid `--force` to prevent breaking changes.
- **CI/CD:** Automated security scans (CodeQL, DevSkim, njsscan, OSSAR, OSV Scanner) run on every
  push.
- **Lockfile integrity:** If `package-lock.json` is missing `resolved`/`integrity` fields, `npm
  install` alone won't fix it while `node_modules` still exists - remove both first.
- **Linting scope:** `super-linter` runs with `VALIDATE_ALL_CODEBASE: false`, but still lints the
  full content of any changed file, not just changed lines.

## Coding and Commit Style Guidelines

When working within this repository, adhere to the following style and commit rules:

- **Code Style**
  - **Indentation:** 2 spaces.
  - **Line Endings:** LF.
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
