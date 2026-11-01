# GEMINI.md

This file provides foundational guidance and architectural context for the App Drawer monorepo.

## Project Overview

App Drawer is a monorepo for Node-based applications using npm workspaces. It is designed to host
multiple utility and service applications, currently focusing on optimized static asset delivery.

### Core Technologies

- **Runtime:** Node.js `>=26.0.0` (`engines` in both `package.json` files; `.nvmrc` pins 26)
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
│       ├── scripts/             # precompress, verify-dist, prepare-dist, policy
│       ├── test/                # Node test runner + supertest suites
│       ├── views/               # EJS templates for 404/500 error pages
│       └── dist/                # Served assets; git-ignored, populated externally
├── package.json                 # Root workspace configuration
├── .npmrc                       # npm hardening (ignore-scripts, release-age gate)
├── .nvmrc                       # Node version for local development (26)
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
  regardless of this setting. PM2 starts workers with `NODE_ENV=production` (the `env` block in
  `ecosystem.config.js`), so details show only under `NODE_ENV=development node server.js`, or
  after a reload by app name with `--update-env` from a shell that exports it (README section
  "Running under PM2").
- **Health Check:** `GET /` returns `{ status: "UP" }` with `Cache-Control: no-store`.
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
- **Graceful shutdown:** `SIGTERM`/`SIGINT` close the HTTP server cleanly, with a 10-second forced
  exit fallback, so PM2 cluster reloads don't drop in-flight requests.
- **Process Management:** PM2 in cluster mode via `ecosystem.config.js`, auto-scales to CPU count
  (`instances: 0`).
- **PM2 shutdown window:** `ecosystem.config.js` `kill_timeout` must stay above
  `SHUTDOWN_TIMEOUT_MS` in `server.js`, otherwise PM2 SIGKILLs workers that are still draining
  requests. `test/ecosystem.test.js` enforces this.
- **PM2 worker flags:** `node_args` in `ecosystem.config.js` is `--disable-proto=delete` only. Do
  not add `--permission`: PM2 7.0.4 and 7.1.1 cluster workers crash at startup with
  `ERR_ACCESS_DENIED` for the inspector API (checked on both), and
  `--allow-inspector` would let a worker bypass the model's restrictions. `test/ecosystem.test.js`
  enforces this, and `test/runtime-hardening.test.js` boots the server with these exact flags.
- **PM2 reload environment:** a reload from the ecosystem file applies only the file's `env` block
  (`NODE_ENV`, `TRUST_PROXY`). Exported `PORT` and `VERIFY_DIST_ON_START` do not reach the
  workers, and a `PORT` given at `pm2 start` is dropped by the first reload. Checked by running
  PM2 7.1.1 (README section "Running under PM2").
- **Docker image:** the `Dockerfile` runs `node --disable-proto=delete server.js` directly as the
  `node` user, with no PM2, on the Node major in `.nvmrc`. `dist/` is mounted at runtime and never
  copied in, which keeps the external `dist/` contract. `test/container-image.test.js` enforces
  the base image, the non-root user, no `dist/` in `COPY`, no `--permission`, and the health
  check. The image was built and run with a mounted `dist/` on 2026-10-31 (non-root, healthy,
  SIGTERM exit 0).

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
create and remove their own `dist/` fixtures, so no pre-built `dist/` is needed). The test files
share those fixtures, so use `npm test`, which passes `--test-concurrency=1`; a bare concurrent
`node --test` races. A leftover `dist/` (for example from a crashed run) makes the startup,
runtime-hardening, and `prepare-dist` default tests skip silently, so delete it if the skipped
count is not 0:

```bash
npm test --workspace=express-static-serve
```

The root `npm test` runs every workspace's tests (`npm test --workspaces --if-present`), and
`npm run test:coverage --workspace=express-static-serve` prints a coverage report and fails below
95% lines, 90% branches, or 85% functions.

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
- **npm hardening:** The root `.npmrc` sets `ignore-scripts=true` (dependency install scripts
  never run; if a package genuinely needs one, run it explicitly with `npm rebuild <pkg>
  --ignore-scripts=false`), `engine-strict=true` (installs fail outside the `engines` range), and
  `min-release-age=7` (npm resolves only versions published at least 7 days ago; versions already
  in the lockfile are unaffected, and `npm update <pkg> --min-release-age=0` adopts a fix sooner).
  `packageManager` pins npm with an integrity hash.
  `npm run audit:signatures` verifies registry signatures and provenance attestations.
  `test/supply-chain.test.js` enforces both settings, plus that the lockfile only resolves from
  `https://registry.npmjs.org/` with integrity hashes and no git, file, or URL dependency specs.
- **CI/CD:** Automated security scans (CodeQL, DevSkim, njsscan, OSV Scanner) run on push to
  `main`, on pull requests targeting `main`, and on a weekly schedule. Dependency Review runs on
  pull requests targeting `main` only. OSSAR and Defender for DevOps were removed: they ran on
  Windows runners and overlapped with the scanners above.
- **Dependabot:** `.github/dependabot.yml` opens npm and github-actions update PRs on a weekly
  schedule, waiting 7 days (`cooldown`) before proposing a new version. npm minor and patch
  bumps are grouped into one pull request (`groups`); major bumps stay separate.
- **Workflow safety:** every `actions/checkout` sets `persist-credentials: false`, and no `run:`
  script may contain a `${{ }}` expression (pass it through `env:` instead); see CLAUDE.md.
- **Lockfile integrity:** If `package-lock.json` is missing `resolved`/`integrity` fields, `npm
  install` alone won't fix it while `node_modules` still exists - remove both first.
- **Transitive vulnerability overrides:** none today. `pm2` 7.1.1 pins `js-yaml` 4.3.2 itself and
  no longer depends on `chokidar` (`braces`) or `proxy-agent` (`get-uri`, `basic-ftp`), so the
  `js-yaml` and `basic-ftp` overrides and the `braces` Trivy and OSV exceptions were removed on
  2026-10-31. If an advisory needs one again, pin the fixed version under `overrides` in the root
  `package.json` and apply it with `npm update <pkg>`; deleting a package's lockfile entry instead
  leaves it uninstalled.
- **GitHub Actions policy:** Every `uses:` is pinned to a full commit SHA with its tag in a
  trailing comment (Dependabot updates both), and every workflow declares top-level `permissions:
  contents: read`, with wider grants only at job level. The long pinned lines exceed 100
  characters, which the YAML linter only warns about. `.github/workflows/ci.yml` runs `npm ci`,
  `test:coverage`, and `audit:signatures` on the Node version in `.nvmrc` (26, also the `engines`
  floor), under a `concurrency` group that cancels superseded pull request runs but never a run
  on `main`. `njsscan.yml` no longer ends in
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
  ESLint; setting `VALIDATE_<LINTER>: false` only disables that one. The `braces` exceptions
  (`.trivyignore`, `osv-scanner.toml`) were removed with the `pm2` 7.1.1 upgrade; add one back only
  for an advisory with no fixed release, and give it an expiry.
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

## Gemini CLI Tooling Notes

- `GET /` is the health check route; it does not go through `setCustomCacheControl` and sets its
  own `Cache-Control: no-store`. Verify
  Cache-Control/compression headers by requesting an actual file under `dist/`, not `/`.
- Refer to `.claude/` for hooks and agents that are mirrored in `.gemini/`.
- **Hook input:** Gemini CLI hooks (if configured) should follow the logic in
  `.claude/lib/hook-input.sh` and refer to `.claude/hooks/` as the source of truth for security
  invariants.
- **Protected files:** Adhere to the protection logic in `.claude/hooks/block-hook-edit.sh` which
  blocks Edit/Write on `.claude/settings.json`, `.gemini/settings.json`, and `hooks/*.sh`.
- **Skills, agents, rules:** Refer to `.claude/skills/`, `.claude/agents/`, and
  `.claude/rules/markdown.md` for full instructions and invariants.

### TODO / Future Improvements

- [x] Pre-compress and verify a populated `dist/`: `scripts/precompress.js` and
  `scripts/verify-dist.js` (see CLAUDE.md, Commands).
- [x] Decide who builds `dist/`: it stays external by design. The contract (required
  `index.html`, no SPA fallback, reload after changes) is documented in the README section
  "Providing `dist/`". Revisit only if this repo gets real content to build, either as an
  in-repo package or a verified artifact fetch.
- [ ] Pre-deploy uplift, design in `docs/superpowers/specs/2026-10-19-repo-uplift-design.md`
  (revised 2026-10-24 with the adversarial review folded in; approved by the owner the same
  day; implemented in the working tree on 2026-10-24, awaiting the owner's review and commit).
  Verified before hand-off: 104/104 tests, 100% branch coverage, `npm audit` clean, a security
  review with no findings, and an adversarial review whose fixes are applied. The design review's
  full text and evidence are in `docs/superpowers/specs/2026-10-19-repo-uplift-design-review.md`.
  Next steps, in order:
  - [x] Fold the adversarial review into the design.
  - [x] Get owner approval of the design.
  - [x] Write the implementation plan (`docs/superpowers/plans/2026-10-24-repo-uplift.md`) and
    build it:
    `TRUST_PROXY` setting (default 0), Apache-2.0 metadata, CSP docs, `NODE_ENV=production`
    under PM2, `no-store` on `GET /`, error page titles, shared script helpers, compression
    list, CI concurrency.
- [ ] Parked until the deployment is known: keep-alive and header timeouts (needs a confirmed
  proxy), the HTTPS directives (`upgrade-insecure-requests`, HSTS), and a longer `immutable`
  cache policy for hashed assets.
- [ ] Verify the njsscan CI run. `|| true` is removed from the step in
  `.github/workflows/njsscan.yml` (owner choice: fail the build) and the upload step now runs
  `if: always()`, but the findings could not be read locally, so the first run may fail. Check it,
  then triage or suppress.
- [ ] `summary.yml` has never run in CI: open a test issue to check the AI summary comment.
- [ ] Enable private vulnerability reporting in the repository settings (`SECURITY.md` relies on
  it); not verifiable from the CLI.
- [ ] Re-run the full super-linter after the pending doc and config edits, before committing
  (the Trivy cache mount in CLAUDE.md helps when disk is tight).
- [ ] Re-review the `braces` exception by 2027-01-15 (`.trivyignore`, `osv-scanner.toml`).
  `pm2` 7.0.4 still depends on `chokidar` `^3.6.0`, which pulls `braces`. `npm audit` stopped
  reporting it on 2026-10-24, but the Trivy and OSV exceptions stay until re-reviewed.
- [ ] Deferred review items (low priority; the plan's status note has the other deviations):
  - `verify-dist` skips symlinks, but the server follows them, so a symlinked variant or
    directory in `dist/` is served unchecked (predates the uplift).
  - The `chmod 000` probe in `test/runtime-hardening.test.js` fails when tests run as root.
  - `parseTrustProxy` coerces non-string input; unreachable today, since env values are strings.
  - Untested PM2 behavior: whether a reload from the ecosystem file with `--update-env` also
    passes other shell variables (`PORT`, `VERIFY_DIST_ON_START`) to workers, and other by-name
    forms such as `pm2 restart --update-env`.
- [x] Applied the 2026-10-24 audit fixes (`body-parser` 2.4.0, `follow-redirects` 1.16.1,
  `ip-address` 10.7.4), audited `CLAUDE.md`, and ran a security review: no findings.
- [x] Decided against a scheduled dependency check (2026-10-24): Dependabot already opens the
  weekly PRs, and Trivy fails on its own when the `braces` exception expires.
