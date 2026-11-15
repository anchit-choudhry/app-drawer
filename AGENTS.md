# AGENTS.md

This file is the shared guidance for every coding agent working in this repository. `CLAUDE.md`
and `GEMINI.md` import it, so a fact lives here once and is not repeated in them.

## Overview

App Drawer is a monorepo of Node-based applications, managed with npm workspaces. It currently
contains a single package, `express-static-serve`, an Express 5 server that serves a pre-built
`dist/` directory with compression negotiation, a content-aware cache policy, and security
headers.

- **Runtime:** Node.js `>=26.0.0` (`engines` in both `package.json` files; `.nvmrc` pins 26).
- **Stack:** Express 5, Helmet, Morgan, `express-static-gzip`, EJS for the error pages, PM2 for
  cluster mode on a host.
- **Module system:** CommonJS (`type: "commonjs"`).

## Layout

- `packages/express-static-serve/`: the only package.
  - `server.js`: `createApp()` builds the app, `start()` parses the environment and listens.
  - `lib/`: `config.js` (strict parsing of every environment variable), `security-headers.js`
    (Helmet, the CSP directives, `Permissions-Policy`), `cache-policy.js` (`Cache-Control` per
    file), `access-log.js` (Morgan setup, JSON format, health check skipping).
  - `trust-proxy.js` (`TRUST_PROXY` parser, used by `lib/config.js`), `ecosystem.config.js` (PM2).
  - `scripts/`: `dist/` tooling (`precompress`, `verify-dist`, `check-csp`, `prepare-dist`, and
    their helpers `dist-common`, `dist-manifest`, `compression-policy`).
  - `views/`: `404.ejs`, `405.ejs`, `500.ejs` and their shared parts.
  - `test/`: Node test runner and supertest suites.
- `Dockerfile` and `.dockerignore` at the root build the container image.
- `.claude/`: hooks, skills, agents, and rules for Claude Code. `.gemini/` holds Gemini CLI stubs
  that mirror the `.claude/` skills, agents, and rules.
- `.github/`: workflows, Dependabot, labeler, issue forms, pull request template, `CODEOWNERS`,
  and `SECURITY.md`.
- `docs/`: `architecture.md`, `threat-model.md`, `runbook.md`, `adr/` (decision records), and
  `superpowers/` (design specs and implementation plans for larger changes).

## Architecture

### express-static-serve

- **Middleware order:** the order below is an invariant, and every stage has one owner in
  `server.js`. Helmet is `securityHeaders()`, Morgan is `createAccessLog()`, the routes stage is
  the health check, the static stage is a default `Cache-Control: no-cache`, the `/.well-known`
  mount, and the compressed static mount, and the 404 stage also answers 405 for any method
  other than GET and HEAD. The error handler is last.
- **App factory:** `createApp({ distDir, config, verboseErrors })` returns an app without
  listening, and `start()` parses the environment, builds the app, and listens. The served
  directory is a factory parameter only: there is no `DIST_DIR` variable. `server.js` runs
  `start()` when it is the entry file.
- **Configuration:** `lib/config.js` parses every variable through `loadConfig`: `PORT` (0 to
  65535, 0 means any free port), `TRUST_PROXY`, `VERIFY_DIST_ON_START`, `LOG_FORMAT`,
  `LOG_HEALTH_CHECKS`, `KEEP_ALIVE_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, and `SHUTDOWN_GRACE_MS`.
  `NODE_ENV` is free-form and only the exact value `development` changes anything. Parsing is
  strict and fails closed: an empty value counts as unset, and anything else that is not an
  accepted value throws and stops the server before it listens. The headers timeout must
  exceed the keep-alive timeout, and an unset one counts as Node's default (5000 and 60000).
  Every new variable must appear in `lib/config.js`, in the README table, and here;
  `test/docs-drift.test.js` enforces the README part.
- **Compression:** `express-static-gzip` matches pre-compressed variants by extension: `.zst`
  (Zstandard), `.br` (Brotli), `.gz` (Gzip), `.zz` (Deflate), in that order of preference.
  A file with no variant is served as is.
- **Cache policy:** `lib/cache-policy.js` gives each file one of three policies, judged by name
  without the variant extension. HTML is `no-cache`. A name carrying a hex hash (8 or more hex
  characters after `.` or `-`, at least one digit and one letter `a` to `f`, then one or two
  extensions) is `public, max-age=31536000, immutable`. Everything else keeps the 2 hour policy
  (`max-age=7200`, `s-maxage=14400`, `must-revalidate`, `proxy-revalidate`). `GET /` and every
  error page are `no-store`, and a response that sets no policy of its own, such as the redirect
  from `/sub` to `/sub/`, is `no-cache`. Build tools that write mixed-case hashes never match
  the hash rule, so their files get the 2 hour policy.
- **Security headers:** `lib/security-headers.js` is the single home of `CSP_DIRECTIVES` (Helmet's
  defaults), which both the server and `scripts/check-csp.js` read, so they cannot drift. It also
  adds a `Permissions-Policy` that denies a fixed list of device and sensor features.
  `test/response-headers.test.js` records every header of three routes in
  `test/fixtures/response-headers.json`; when a change to headers is intended, run
  `UPDATE_SNAPSHOTS=1 npm test --workspace=express-static-serve -- test/response-headers.test.js`
  and review the diff.
- **Error pages:** `views/404.ejs`, `views/405.ejs`, and `views/500.ejs` are rendered by the 404
  stage and the final error handler. Both send `Cache-Control: no-store` and remove the headers
  of the file that failed or fell through (`Content-Encoding`, `Content-Type`, `ETag`,
  `Last-Modified`, `Accept-Ranges`, and `Content-Range` except on a 416), because
  `express-static-gzip` sets them before it knows whether it will send the file.
  `app.set("verbose errors", ...)` controls whether `500.ejs` shows the message and stack; it
  fails closed and is only enabled when `NODE_ENV=development`. The error is always logged
  server-side via `console.error`. PM2 starts workers with `NODE_ENV=production`, so details show
  only under `NODE_ENV=development node packages/express-static-serve/server.js`.
- **Methods and dot paths:** only GET and HEAD are served; any other method answers 405 with
  `Allow: GET, HEAD`. Dot paths are never served, with one exception: `/.well-known/` (a
  top-level `dist/.well-known/` directory) is served as is, without compressed variants, and the
  dotfiles inside it stay hidden.
- **Health check:** `GET /` returns `{ "status": "UP" }` with `Cache-Control: no-store`. While the
  server shuts down it answers `503` with `{ "status": "DRAINING" }`, and `SHUTDOWN_GRACE_MS`
  (default 0, at most 9000) keeps the server accepting requests for that long first, so a load
  balancer can notice before the socket closes.
- **Access log:** `LOG_FORMAT` is `combined` (default) or `json`, one object per line with the
  keys `time`, `remoteAddr`, `method`, `url`, `status`, `bytes`, `responseTimeMs`, `referrer`,
  and `userAgent`. Morgan escapes every string its tokens return, so the JSON format reads the
  method, URL, referrer, and user agent from the request itself and escapes the C1 control
  characters and line separators that `JSON.stringify` leaves alone. `LOG_HEALTH_CHECKS=false`
  leaves `GET /` and `HEAD /` out of the log.
- **Graceful shutdown:** `SIGTERM` and `SIGINT` set the draining flag, wait out the grace period,
  and close the HTTP server, with a 10-second forced exit counted from the signal, so PM2 cluster
  reloads do not drop in-flight requests.
- **Trust proxy:** `app.set("trust proxy", ...)` takes the `TRUST_PROXY` variable, parsed by
  `parseTrustProxy` in `trust-proxy.js` through `lib/config.js`. It defaults to `0` (no proxy
  trusted); set the number of reverse proxy or CDN hops, from 0 to 10, and no more than the real
  number: a larger value lets a visitor choose the logged client address. Anything else (`true`,
  `loopback`, spaces) throws. `start()` parses it before listening, and `ecosystem.config.js`
  validates it, so a bad value stops `pm2 start` and a reload from the ecosystem file before any
  worker changes. The tests clear every configuration variable themselves. Only the access log
  reads the client IP.
- **Process management:** PM2 in cluster mode via `ecosystem.config.js`, one worker per CPU
  (`instances: 0`). PM2 is a dependency of the repository root, not of the workspace package.
- **PM2 shutdown window:** `ecosystem.config.js` `kill_timeout` must stay above
  `SHUTDOWN_TIMEOUT_MS` in `lib/config.js`, otherwise PM2 SIGKILLs workers that are still draining
  requests. `test/ecosystem.test.js` enforces this.
- **PM2 worker flags:** `node_args` in `ecosystem.config.js` is `--disable-proto=delete` only. Do
  not add `--permission`: PM2 7.0.4 and 7.1.1 cluster workers crash at startup with
  `ERR_ACCESS_DENIED` for the inspector API (checked on both), and `--allow-inspector` would let a
  worker bypass the model's restrictions. `test/ecosystem.test.js` enforces this, and
  `test/runtime-hardening.test.js` boots the server with these exact flags.
- **PM2 reload environment:** `ecosystem.config.js` validates every supported variable and
  forwards all of them in its `env` block (with `NODE_ENV=production`), as strings, with an empty
  string for a variable that has no value. A reload from the ecosystem file applies only that
  block, so a variable that is not exported on the reload goes back to its default: checked with
  PM2 7.1.1, `LOG_FORMAT=json` at start became `combined` after a reload that did not export it,
  and a `PORT` exported on the reload took effect. A bad value stops the reload in the terminal
  and leaves the workers running. Reload from the ecosystem file, never by app name with
  `--update-env`, which hands the shell environment to the workers.
- **Docker image:** the `Dockerfile` runs `node --disable-proto=delete` on `server.js` directly as
  the `node` user, with no PM2, on the Node major in `.nvmrc`, with the base image pinned by
  digest (Dependabot's `docker` entry proposes new digests). The install step reads only the
  workspace, so PM2 is not in the image. `dist/` is mounted at runtime and never copied in, which
  keeps the external `dist/` contract. `test/container-image.test.js` enforces the digest pin,
  that every local module the server loads is copied, the non-root user, no `dist/` in `COPY`, no
  `--permission`, and the health check. The image was built and run read-only with no capabilities
  and a mounted `dist/` on 2026-11-15 (digest-pinned base, `lib/` copied, no PM2, user 1000,
  healthy after about 8 seconds, SIGTERM exit 0, 378 MB).
- **Missing `dist/`:** the server still starts and `GET /` still reports `UP`; only the startup
  warning and 404s on every other path reveal a bad deploy. Startup problems are reported by PM2
  instance 0 only (`NODE_APP_INSTANCE`), so a cluster logs them once. A `dist/` with a manifest
  logs `Serving dist build <12 hex characters>`; one without logs that it has no manifest and
  that files are served uncompressed. Set `VERIFY_DIST_ON_START=true` to also run the full
  `verify-dist` and `check-csp` checks at boot; each problem is logged as a warning and never
  stops the server. It is off by default because it reads and decompresses every variant.
- **`dist/` contract:** `dist/` is git-ignored and built outside this repo by design, so do not
  add a build step without asking. `GET /` is the health check, so the root `index.html` is only
  reachable at `/index.html` (a subfolder serves its own at `/sub/`), and there is no SPA
  fallback: unknown paths return the 404 page. `prepare-dist` is the single post-build step and
  runs three: `precompress` (writes the variants and `dist/.dist-manifest.json`), `verify-dist`,
  and `check-csp`. The manifest records the SHA-256, size, and variants of every source file and
  lets the build be named by a short id; it detects partial, stale, or accidental changes, not
  someone who can also rewrite it. `verify-dist` fails on a missing manifest, a symlink (the
  server follows symlinks, which is why they are rejected), and a stray dot entry. `check-csp`
  is a regex lint of the HTML in `dist/` against `CSP_DIRECTIVES`; any finding fails
  `prepare-dist`. `express-static-gzip` lists compressed variants once at startup, so after
  changing `dist/` run `prepare-dist` and reload the PM2 workers from the ecosystem file. The
  README section "Providing `dist/`" is the user-facing version.

## Commands

The server requires a `dist/` directory inside `packages/express-static-serve/` to serve static
files. There is no build step in this repository; `dist/` is populated externally (a deliberate
decision, see the `dist/` contract above).

Setup: `nvm use` (it reads `.nvmrc`, Node 26), then `npm ci`. The `.npmrc` blocks dependency
install scripts, so nothing runs during the install.

Run these from the repository root.

- `npm run start:express-static-serve` starts PM2 in cluster mode.
- `npm run stop:express-static-serve` stops the PM2 app by name.
- `npm run logs:express-static-serve` shows the PM2 logs.

  All three use `packages/express-static-serve/ecosystem.config.js`.
- `node packages/express-static-serve/server.js` starts one process on `PORT` (default 3000).
  The variables are tabled in the README.

Four scripts operate on a populated `dist/` (default `packages/express-static-serve/dist`, or pass
a directory), run via `npm run <script> --workspace=express-static-serve`:

- `precompress` writes the `.zst`/`.br`/`.gz`/`.zz` variants and the manifest. It skips a file
  whose content, variants, and compression policy are unchanged, and it never writes through a
  symlink. What gets compressed is tuned in `scripts/compression-policy.js`.
- `verify-dist` checks the layout, the variants, and the manifest.
- `check-csp` lints the HTML against the Content-Security-Policy the server sends.
- `prepare-dist` runs `precompress`, then `verify-dist`, then `check-csp`, and runs both checks
  even if the first fails.

All of them need `zlib.zstdCompressSync`, which the Node 26 requirement covers.

Tests and checks:

- `npm test` runs every workspace's tests. The tests build their own scratch `dist/` fixtures
  under `test/.tmp-*`, bind free ports, and run in parallel, so they need no pre-built `dist/` and
  are not affected by one; the skipped count is 0.
- One test file: `npm test --workspace=express-static-serve -- test/server.test.js`.
- Test gotchas: the Node test runner treats every `.js` file under `test/` as a test, so
  `test/helpers.js` lives there and no launcher script may be added. A test that starts the
  server does it through `startServer` in `test/helpers.js` (a free port and a cleaned
  environment) and never on a fixed port, and anything it creates goes under `test/.tmp-*` and
  is removed afterwards.
- `npm run test:coverage --workspace=express-static-serve` prints a coverage report and fails
  below 95% lines, 90% branches, or 85% functions.
- `npm run audit:signatures` verifies registry signatures and provenance attestations.

## CI/CD

### Security and maintenance

- **Vulnerability scanning:** regularly run `npm audit`. Fix with `npm audit fix`, and avoid
  `--force` to prevent breaking changes.
- **npm hardening:** the root `.npmrc` sets `ignore-scripts=true` (dependency install scripts never
  run; if a package genuinely needs one, run it explicitly with `npm rebuild <pkg>
  --ignore-scripts=false`), `engine-strict=true` (installs fail outside the `engines` range), and
  `min-release-age=7` (npm resolves only versions published at least 7 days ago; versions already
  in the lockfile are unaffected, and `npm update <pkg> --min-release-age=0` adopts a fix sooner).
  `packageManager` pins npm with an integrity hash. `test/supply-chain.test.js` enforces both
  settings, plus that the lockfile only resolves from `https://registry.npmjs.org/` with
  integrity hashes and no git, file, or URL dependency specs, and that the two `package.json`
  files carry the same version with `pm2` only in the root.
- **Lockfile integrity:** if `package-lock.json` is missing `resolved` or `integrity` fields,
  `npm install` alone will not fix it while `node_modules` still exists; remove both first.
- **Transitive vulnerability overrides:** none today. `pm2` 7.1.1 pins `js-yaml` 4.3.2 itself and
  no longer depends on `chokidar` (`braces`) or `proxy-agent` (`get-uri`, `basic-ftp`), so the
  `js-yaml` and `basic-ftp` overrides and the `braces` Trivy and OSV exceptions were removed on
  2026-10-31. If an advisory needs one again, pin the fixed version under `overrides` in the root
  `package.json` and apply it with `npm update <pkg>`; deleting a package's lockfile entry instead
  leaves it uninstalled. Add a Trivy or OSV exception only for an advisory with no fixed release,
  and give it an expiry.
- **Workflows:** CodeQL, DevSkim, njsscan, and OSV Scanner run on push to `main`, on pull requests
  targeting `main`, and on a weekly schedule; Dependency Review runs on pull requests only.
  `ci.yml` runs `npm ci`, `test:coverage`, and `audit:signatures` on the Node version in
  `.nvmrc`, under a `concurrency` group that cancels superseded pull request runs but never a
  run on `main`. `container.yml` builds the image, runs it read-only with no capabilities, waits
  for its health check, smoke-tests it, and scans it with Trivy; nothing is published.
  `scorecard.yml` runs OpenSSF Scorecard and `release.yml` creates a release with a CycloneDX
  SBOM on a `v*.*.*` tag whose version matches `package.json`. `njsscan.yml` no longer ends in
  `|| true`, so its findings fail the job.
- **GitHub Actions policy:** every `uses:` is pinned to a full commit SHA with its tag in a
  trailing comment (Dependabot updates both), every workflow declares top-level `permissions:
  contents: read` with wider grants only at job level, and every job has a `timeout-minutes`.
  Every `actions/checkout` sets `persist-credentials: false`, and no `run:` script may contain a
  `${{ }}` expression: event fields and step outputs (an issue body, a model's reply) can be
  attacker-controlled, so pass them through `env:` and quote the variable. Every registry image
  used in a `run:` script is pinned by digest; the Trivy image in `container.yml` is updated by
  hand, because Dependabot does not see it. The long pinned lines exceed 100 characters, which the
  YAML linter only warns about. Dependabot waits 7 days (`cooldown`) before proposing a version,
  matching `min-release-age`, and groups npm minor and patch bumps into one pull request.
  `test/supply-chain.test.js` enforces the pinning, the permissions, the timeouts, the checkout
  and `run:` rules, and the image pins.
- **Linting scope:** `super-linter` (the `super-linter/super-linter/slim` action, pinned to a SHA
  like every other action) runs with `VALIDATE_ALL_CODEBASE: false`, but still lints the full
  content of any changed file, not just changed lines.
- **Linter config:** each linter reads a fixed file name from `.github/linters/`:
  `.markdown-lint.yml` (not `.markdownlint.yml`, which super-linter silently ignores),
  `.editorconfig-checker.json`, `.jscpd.json`, `.textlintrc`, `.codespellrc`, `.yaml-lint.yml`,
  and `zizmor.yaml`. Prettier reads the root `.prettierrc.json` and `.prettierignore` (Markdown is
  ignored there). Biome is switched off in the workflow because it conflicts with Prettier and
  ESLint; setting `VALIDATE_<LINTER>: false` only disables that one.
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

## Coding and commit style guidelines

When working within this repository, adhere to the following style and commit rules:

- **Code style:** 2 spaces, LF line endings, a maximum line length of 100 characters, CommonJS
  (`require` and `module.exports`), and double quotes with semicolons (see `.prettierrc.json`).
- **Typography:** never use en dashes or em dashes in code, documentation, or commit messages.
  Use only standard hyphens (-). `test/docs-drift.test.js` enforces this across the repository.
- **Commit safety:** do not create commits automatically; only commit when explicitly instructed.
  Never suggest `git commit`.
- **Problem resolution:** if unsure or if there is more than one way a task can be done, conduct
  surveys or Q&A.
- **Commit messages:** use past participles (for example "Added", "Fixed", "Updated"). For code
  refactoring, simplification, and formatting, a one-line commit message of "Refactored and
  Formatted code" is acceptable.
- **Scratch files:** keep them inside the repository, in `.tmp-*` directories (root or
  `packages/express-static-serve/test/`), which are git-ignored, and remove them when done.

## AI and agent guidelines

When generating or reviewing code for this project, LLMs and agents must adhere to the following
invariants:

- **Middleware order:** always maintain the prescribed order, which is one line here so that it
  can be searched for:
  Helmet -> Morgan -> routes -> static files -> 404 handler -> error handler.
- **Configuration:** never introduce undocumented configuration changes or bypass security checks.
  A new environment variable needs `lib/config.js`, the README table, and this file.
- **Process:** trust the framework's guarantees, and only validate at system boundaries (user
  input, external APIs).
- **Security:** prioritize safe, secure, and correct code, avoiding common OWASP Top 10
  vulnerabilities. Error pages must stay uncached and must not carry another file's headers.

## See also

- [README](README.md) for the user-facing documentation and the configuration table.
- [Architecture](docs/architecture.md), [threat model](docs/threat-model.md), and
  [runbook](docs/runbook.md) for how the server works, what it defends against, and how to
  operate it.
- [Decision records](docs/adr/README.md) for why the main choices were made.
- [Contributing](CONTRIBUTING.md) and [changelog](CHANGELOG.md).
