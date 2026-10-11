# GEMINI.md

This file provides foundational guidance and architectural context for the App Drawer monorepo.

## Project Overview

App Drawer is a monorepo for Node-based applications using npm workspaces. It is designed to host
multiple utility and service applications, currently focusing on optimized static asset delivery.

### Core Technologies

- **Runtime:** Node.js `>=22.15.0` (`engines` in both `package.json` files; `.nvmrc` pins 24)
- **Framework:** Express.js (v5)
- **Process Management:** PM2 (Cluster mode)
- **Middleware:** Helmet (Security), Morgan (Logging), express-static-gzip (Compression)
- **Templating:** EJS (Error pages, currently in `views/` directory)

## Architecture

The project follows a monorepo structure using npm workspaces located in the `packages/` directory.

```text
app-drawer/
├── packages/
│   └── express-static-serve/    # Specialized Express server
│       ├── server.js            # Main entry point
│       ├── ecosystem.config.js  # PM2 cluster configuration
│       ├── package.json
│       ├── scripts/             # precompress, verify-dist, and prepare-dist helpers
│       ├── test/                # Node test runner + supertest suites
│       └── views/               # EJS templates for 404/500 error pages
├── package.json                 # Root workspace configuration
├── .claude/                     # Claude Code hooks, agents, and skills for this repository
├── .gemini/                     # Gemini CLI skills and configuration for this repository
└── .github/                     # CI/CD workflows and Dependabot config
```

### express-static-serve

This package serves static assets from a `dist/` directory (expected to be populated externally).

- **Port:** Defaults to `3000`, overridable via the `PORT` environment variable.
- **Module System:** CommonJS (`type: "commonjs"`)
- **Static Assets:** Served from `dist/` (must be pre-built) via `express-static-gzip`.
  Pre-compressed variants are matched by file extension: `.zst` (Zstandard), `.br` (Brotli), `.gz`
  (Gzip), `.zz` (Deflate). Uncompressed files are served as-is if no matching variant exists.
- **Compression Negotiation Order:** Zstandard -> Brotli -> Gzip -> Deflate.
- **Caching:** Public cache with 2-hour client `max-age`, 4-hour proxy `s-maxage`,
  `must-revalidate`, and `proxy-revalidate`.
- **Middleware Order:** Helmet (security headers) -> Morgan (logging) -> routes -> static files ->
  404 handler -> error handler.
- **Error pages:** `views/404.ejs` and `views/500.ejs` are rendered by the catch-all 404 handler and
  the final error-handling middleware in `server.js`. `app.set("verbose errors", ...)` controls
  whether `500.ejs` includes the error message and stack trace; it fails closed and is only enabled
  when `NODE_ENV=development`. The error is always logged server-side via `console.error`
  regardless of this setting.
- **Health Check:** `GET /` returns `{ status: "UP" }`.
- **Missing `dist/`:** the server still starts and `GET /` still reports `UP`; only the startup
  warning and 404s on every other path reveal a bad deploy.
- **Trust proxy:** `app.set("trust proxy", 1)` - the server expects exactly one reverse
  proxy/CDN hop in front of it. Update this if the deployment topology changes.
- **Graceful shutdown:** `SIGTERM`/`SIGINT` close the HTTP server cleanly, with a 10-second forced
  exit fallback, so PM2 cluster reloads don't drop in-flight requests.
- **Process Management:** PM2 in cluster mode via `ecosystem.config.js`, auto-scales to CPU count
  (`instances: 0`).
- **PM2 shutdown window:** `ecosystem.config.js` `kill_timeout` must stay above
  `SHUTDOWN_TIMEOUT_MS` in `server.js`, otherwise PM2 SIGKILLs workers that are still draining
  requests. `test/ecosystem.test.js` enforces this.

## Building and Running

### Root Commands (Delegates to PM2)

- `npm run start:express-static-serve`: Start server via PM2 (cluster mode, auto-scales to CPU
  count).
- `npm run stop:express-static-serve`: Stop the PM2 app by name (`express-static-serve`).
- `npm run logs:express-static-serve`: Stream PM2 logs.

### Preparing `dist/`

Run via `npm run <script> --workspace=express-static-serve` against a populated `dist/` (default
`packages/express-static-serve/dist`, or pass a directory):

- `precompress`: writes the `.zst`/`.br`/`.gz`/`.zz` variants the server negotiates. Re-run it
  after every `dist/` change: a stale variant is served instead of the current file. What gets
  compressed is tuned in `scripts/compression-policy.js`.
- `verify-dist`: fails on a missing `index.html`, orphaned variants, or variants that no longer
  match their source.
- `prepare-dist`: runs `precompress` and then `verify-dist`; use it as the single post-build step.

### Local Development

To run the server directly without PM2:

```bash
cd packages/express-static-serve && node server.js
```

*Note: Ensure a `dist/` directory exists within `packages/express-static-serve/` before running.*

### Testing

To run the `express-static-serve` test suite (Node's built-in test runner + supertest; tests
create and remove their own `dist/` fixtures, so no pre-built `dist/` is needed):

```bash
npm test --workspace=express-static-serve
```

The root `npm test` runs every workspace's tests (`npm test --workspaces --if-present`), and
`npm run test:coverage --workspace=express-static-serve` prints a coverage report.

## Development Conventions

### For AI Agents

- **Commit Safety:** Do not create commits automatically; only commit when explicitly instructed.
  Never suggest `git commit`.
- **Problem Resolution:** If unsure or if there is more than one way a task can be done, conduct
  surveys or Q&A.
- **Commit Messages:** Use past participles in commit messages (e.g., "Added", "Fixed", "Updated").
  For code refactoring, simplification, and formatting, a one-line commit message of "Refactored and
  Formatted code" is acceptable.
- **Documentation and Commit Messages:** Never use en dashes (–) or em dashes (—) in documentation
  or commit messages.

#### Invariants for AI Agents

- **Middleware Order:** Always maintain the prescribed middleware order: Helmet -> Morgan ->
  routes -> static files -> 404 handler -> error handler.
- **Configuration:** Never introduce undocumented configuration changes or bypass security checks.
- **Process:** Trust the framework's guarantees, only validating at system boundaries (user input,
  external APIs).
- **Security:** Prioritize writing safe, secure, and correct code, avoiding common OWASP Top 10
  vulnerabilities.

### Code Style

- **Indentation:** 2 spaces.
- **Line Endings:** LF.
- **Max Line Length:** 100 characters.
- **Module System:** CommonJS (`require`/`module.exports`).
- **Typography:** **NEVER** use en dashes (–) or em dashes (—). Use only standard hyphens (-).

### Security & Maintenance

- **Vulnerability Scanning:** Regularly run `npm audit`.
- **Fixing Vulnerabilities:** Use `npm audit fix`. Avoid `--force` to prevent breaking changes.
- **CI/CD:** Automated security scans (CodeQL, DevSkim, njsscan, OSSAR, OSV Scanner, Defender for
  DevOps) run on push to `main`, on pull requests targeting `main`, and on a weekly schedule.
  Dependency Review runs on pull requests targeting `main` only.
- **Dependabot:** `.github/dependabot.yml` opens npm update PRs on a weekly schedule.
- **Lockfile integrity:** If `package-lock.json` is missing `resolved`/`integrity` fields, `npm
  install` alone won't fix it while `node_modules` still exists - remove both first.
- **Transitive vulnerability overrides:** The root `package.json` pins `js-yaml` to `4.3.2` via
  `overrides` because `pm2` pins an exact vulnerable `js-yaml@4.3.1` (GHSA-2883-xcg3-v3hh) and has
  no looser range to update into. This avoids `npm audit fix --force`, which would otherwise
  downgrade `pm2` from `7.0.4` to `5.3.1`. Remove the override once `pm2` bumps its own `js-yaml`
  dependency past `4.3.1`.
- **Linting scope:** `super-linter` runs with `VALIDATE_ALL_CODEBASE: false`, but still lints the
  full content of any changed file, not just changed lines.

## Gemini CLI Tooling Notes

- `GET /` is the health check route and does not go through `setCustomCacheControl`. Verify
  Cache-Control/compression headers by requesting an actual file under `dist/`, not `/`.
- Refer to `.claude/` for hooks and agents that are mirrored in `.gemini/`.

### TODO / Future Improvements

- [x] Pre-compress and verify a populated `dist/`: `scripts/precompress.js` and
  `scripts/verify-dist.js` (see CLAUDE.md, Commands).
- [ ] Define the build process that produces the assets in `dist/` (still external; the source
  and toolchain are undecided).
