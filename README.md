# App Drawer

[![Apache License 2.0][lic-b]][lic-l]
[![CI][ci-b]][ci-l]
[![CodeQL][cql-b]][cql-l]
[![DevSkim][dvs-b]][dvs-l]
[![Lint Code Base][lnt-b]][lnt-l]
[![njsscan][njs-b]][njs-l]
[![OSV Scanner][osv-b]][osv-l]
[![Container][ctr-b]][ctr-l]
[![OpenSSF Scorecard][scr-b]][scr-l]

Powered by

[![Express.js][exp-b]][exp-l]
[![GitHub Actions][gha-b]][gha-l]

Monorepo for Node based apps

## express-static-serve

Express server that serves pre-built static assets from `packages/express-static-serve/dist/`.
It negotiates pre-compressed variants (Zstandard, Brotli, Gzip, Deflate) and applies security
headers. This repo does not build `dist/` by design; it is populated externally, and the server
logs a warning at startup when it is missing. After populating it, run `prepare-dist` to create the
compressed variants and check the result (see "Providing `dist/`" below).

Requires Node 26 or later (`.nvmrc` pins 26).

| Variable                | Default    | Purpose                                                  |
| ----------------------- | ---------- | -------------------------------------------------------- |
| `PORT`                  | `3000`     | HTTP port, 0 to 65535; `0` picks a free one              |
| `TRUST_PROXY`           | `0`        | Proxy hops to trust, 0 to 10; see "Running under PM2"    |
| `VERIFY_DIST_ON_START`  | `false`    | `true` runs `verify-dist` and `check-csp` at startup     |
| `LOG_FORMAT`            | `combined` | `combined` or `json` access log                          |
| `LOG_HEALTH_CHECKS`     | `true`     | `false` leaves `GET /` out of the log                    |
| `KEEP_ALIVE_TIMEOUT_MS` | unset      | 1000 to 300000; unset keeps the Node default (5000)      |
| `HEADERS_TIMEOUT_MS`    | unset      | 1000 to 600000; unset keeps the Node default (60000)     |
| `SHUTDOWN_GRACE_MS`     | `0`        | 0 to 9000; how long `GET /` answers 503 before closing   |
| `NODE_ENV`              | unset      | `development` shows 500 details; PM2 sets `production`   |

Every value is checked when the server starts. An empty value counts as unset, and anything else
that is not accepted (`true` or `false` for the two flags, the listed words for `LOG_FORMAT`,
whole numbers in the listed ranges, with no sign, decimal, space, or leading zero) stops the
server with an error that names the variable, before it listens. The headers timeout must be
greater than the keep-alive timeout; a timeout that is not set counts as Node's default. Only the
exact value `development` changes anything for `NODE_ENV`.

```bash
npm ci
npm test                             # all workspace tests
npm run test:coverage --workspace=express-static-serve
npm run precompress --workspace=express-static-serve   # write .zst/.br/.gz/.zz next to dist assets
npm run verify-dist --workspace=express-static-serve   # check layout, variants, and manifest
npm run check-csp --workspace=express-static-serve      # lint the HTML against the CSP
npm run prepare-dist --workspace=express-static-serve  # precompress, verify-dist, check-csp
npm run audit:signatures             # verify registry signatures and provenance
npm run start:express-static-serve   # PM2 cluster mode, one worker per CPU
npm run stop:express-static-serve
npm run logs:express-static-serve
```

For local development without PM2, run `node server.js` from `packages/express-static-serve/`.

`GET /` returns `{ "status": "UP" }` with `Cache-Control: no-store`, so a CDN cannot keep serving
a stale answer. It does not check that `dist/` exists. While the server shuts down it answers
`503` with `{ "status": "DRAINING" }`. Behind a load balancer, set `SHUTDOWN_GRACE_MS` so the
server keeps accepting requests for that long first and the balancer can notice the 503 before the
socket closes; keep it below the platform's stop timeout (at most 9000, because the forced exit
comes 10 seconds after the signal).

### Running under PM2

`npm run start:express-static-serve` loads `ecosystem.config.js`, which starts the workers in
production mode and passes every variable in the table above to them. `TRUST_PROXY` is the number
of reverse proxy or CDN hops the server trusts when it works out a visitor's IP address, which
only the access log uses. It defaults to `0`, so no proxy is trusted. Set it to `1` once exactly
one proxy or CDN sits in front of the server.

The value is parsed strictly. Only an unset or empty value (meaning `0`) or a whole number from
`0` to `10` is accepted. `true`, `loopback`, signs, decimals, leading zeros, spaces, and larger
numbers stop the server and PM2 with an error that names the value, because Express would treat
`true` as "trust every hop" and let any visitor forge their address.

To change it, reload from the ecosystem file, which PM2 reads again:

```bash
TRUST_PROXY=1 npx pm2 reload packages/express-static-serve/ecosystem.config.js --update-env
```

The file validates every variable with the same parser as the server and forwards all of them to
the workers, with an empty string for a variable that has no value. Checked by running PM2 7.1.1
(the last bullet was first seen on 7.0.4):

- A reload from the file applies only the file's `env` block. A variable that is not exported on
  the reload goes back to its default: `LOG_FORMAT=json` at start became `combined` after a reload
  that did not export it, and `TRUST_PROXY` goes back to `0`. A variable that is exported on the
  reload takes effect (a `PORT` did), so export every non-default value each time.
- A bad value on `pm2 start` or on a reload from the file (a bad `PORT` was tried) stops in the
  terminal with an error naming the value. On a reload, the running workers are left alone.
- Workers keep `NODE_ENV=production` when the file is reloaded, even if your shell has exported
  `NODE_ENV=development`.
- **Do not reload by app name together with `--update-env`.** That form skips the file and hands
  your shell environment to the workers. A shell with `NODE_ENV=development` then turned error
  details on, and a bad `TRUST_PROXY` left every worker in the `errored` state, which is an
  outage.

### Running in Docker

The `Dockerfile` runs the server as one plain `node` process, as the non-root `node` user, with
`NODE_ENV=production` and `PORT=3000`. `dist/` is not part of the image: mount it read-only. Both
base image references in the `Dockerfile` are pinned by digest, and Dependabot proposes new ones.

```bash
docker build -t app-drawer .
docker run --init --read-only --cap-drop=ALL -p 3000:3000 \
  -v "$PWD/packages/express-static-serve/dist:/app/packages/express-static-serve/dist:ro" \
  app-drawer
```

- The run command above is the locked-down form that the `container.yml` workflow smoke-tests:
  read-only file system and no capabilities.
- Behind a proxy, add `-e TRUST_PROXY=1`. The value is parsed as strictly as under PM2, and a bad
  one stops the container at startup. Every variable in the table works with `-e`.
- There is one process per container and no PM2: run more containers (or let the platform restart
  them) for more capacity.
- The image has a health check that requests `GET /`, which answers even without `dist/`.
- The server lists the compressed variants once at startup, so after changing `dist/` run
  `prepare-dist` and restart the container.

### Providing `dist/`

`dist/` is git-ignored and built outside this repo on purpose. Whatever pipeline produces the
assets delivers them to `packages/express-static-serve/dist/`. The server expects:

- **`index.html` at the top level.** `verify-dist` fails without it. It is served at
  `/index.html`, not `/`, because `GET /` is reserved for the health check. A subfolder's
  `index.html` is served at `/subfolder/`.
- **No single-page-app fallback.** Unknown paths return the 404 page, so every route needs a real
  file (or use hash-based routing).
- **Cache policy by file name.** Name assets with a content hash so they can be cached for a
  year; the server judges the name without a compression extension:

  | Files                        | Policy                                                  |
  | ---------------------------- | ------------------------------------------------------- |
  | HTML (`.html`, `.htm`)       | `no-cache`                                              |
  | A hex hash in the name       | `public, max-age=31536000, immutable`                   |
  | Everything else              | 2 hours in browsers, 4 hours in shared caches (below)   |
  | `GET /` and every error page | `no-store`                                              |

  The 2 hour policy is `public, max-age=7200, must-revalidate, s-maxage=14400,
  proxy-revalidate`.

  The hash rule: 8 or more lower-case hex characters after `.` or `-`, holding at least one digit
  and one letter `a` to `f`, then one or two extensions. `app.3f9a1c7e.js` and
  `chunk-0a1b2c3d4e.css.map` match. `app.1234567890.js` (digits only), `app.deadbeef.js` (letters
  only), `app.3F9A1C7E.js` (upper case), and `bundle.js` do not, so they get the 2 hour policy.
  Build tools that write mixed-case hashes therefore never get `immutable`. A response that sets
  no policy of its own, such as the redirect from `/sub` to `/sub/`, is `no-cache`.
- **Dot entries.** Dot paths are never served. The one exception is a top-level
  `dist/.well-known/` directory, served as is, without compressed variants, with its dotfiles
  still hidden. `verify-dist` fails on any other dot entry, and on any symlink: the server follows
  symlinks, so they are rejected before delivery rather than at runtime.
- **Manifest.** `precompress` writes `dist/.dist-manifest.json` with the SHA-256, size, and
  variants of every source file. The server logs `Serving dist build <12 hex characters>` at
  startup, so the live build can be named. The manifest detects partial, stale, or accidental
  changes; it does not defend against someone who can also rewrite it.
- **CSP check.** `check-csp` reads the HTML in `dist/` and reports inline scripts, inline event
  handlers, and URLs that the server's Content-Security-Policy would block. Any finding fails
  `prepare-dist`. It is a regex lint with two limits: it cannot see requests that JavaScript
  makes, and an absolute URL to the site's own host counts as another origin, so use relative
  URLs.

Helmet's default security headers also decide what the pages in `dist/` can do. Console messages
such as "Refused to execute inline script" or "Refused to load..." mean one of these rules blocked
something:

- **Scripts:** only script files from the same origin run. Inline `<script>` blocks and inline
  event handlers such as `onclick` are blocked.
- **Styles and fonts:** inline styles are allowed, and stylesheets and fonts may come from any
  `https:` source. Fonts may also be `data:` URIs.
- **Images:** only the same origin and `data:` URIs. Images from other hosts are blocked.
- **Network calls:** `fetch`, XHR, and WebSocket requests to other origins are blocked, because
  `connect-src` falls back to `default-src 'self'`.
- **Other origins:** `Cross-Origin-Resource-Policy: same-origin` makes browsers refuse to let a
  page on another origin, such as a different hostname, embed these files. A CDN or proxy that
  serves them under the page's own hostname is not affected. Only the same origin may frame a
  page.
- **Plain HTTP:** `upgrade-insecure-requests` asks browsers to request every `http:` subresource
  of a page over HTTPS instead. Over plain HTTP this may leave a page without its CSS, scripts,
  or images. It has not been tested in a browser, and it is the directive most likely to break a
  first deploy.
- **HSTS:** `Strict-Transport-Security` lasts one year and includes subdomains. A browser that
  sees it on an HTTPS response will use HTTPS for that host and its subdomains for a year (for
  `www.example.com`, that means `*.www.example.com`; the whole domain only if the site is served
  from `example.com` itself).
- **Device and sensor features:** a `Permissions-Policy` header denies `accelerometer`,
  `browsing-topics`, `camera`, `display-capture`, `geolocation`, `gyroscope`, `magnetometer`,
  `microphone`, `midi`, `payment`, and `usb`.

To relax any of these rules, edit `lib/security-headers.js` (the CSP directives and the denied
feature list live there, and `check-csp` reads the same directives), then run the
`express-security-reviewer` agent on the change.

To deliver a new build:

1. Replace the contents of `dist/` in one step rather than editing it in place.
2. Run `npm run prepare-dist --workspace=express-static-serve`. It runs three steps and runs the
   last two even if the first fails: `precompress` writes the compressed variants and the
   manifest, `verify-dist` checks the layout, variants, and manifest, and `check-csp` lints the
   HTML against the CSP.
3. Restart the workers by reloading from the ecosystem file (see "Running under PM2"). The server
   lists the compressed variants once at startup, so added, removed, or renamed variants are only
   picked up after a restart. Set `VERIFY_DIST_ON_START=true` to re-run both checks at each boot;
   each problem is logged as a warning and never stops the server.

## See also

- [Architecture](docs/architecture.md): how a request and a `dist/` build flow through the server.
- [Threat model](docs/threat-model.md): what the server defends against and what it does not.
- [Runbook](docs/runbook.md): deploy, roll back, and a symptom table.
- [Decision records](docs/adr/README.md): why the main choices were made.
- [Contributing](CONTRIBUTING.md) and [changelog](CHANGELOG.md).

[lic-b]: https://img.shields.io/badge/License-Apache_2.0-blue.svg
[lic-l]: https://github.com/anchit-choudhry/app-drawer/blob/main/LICENSE
[ci-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/ci.yml/badge.svg
[ci-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/ci.yml
[cql-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/codeql.yml/badge.svg
[cql-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/codeql.yml
[dvs-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/devskim.yml/badge.svg
[dvs-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/devskim.yml
[lnt-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/super-linter.yml/badge.svg
[lnt-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/super-linter.yml
[njs-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/njsscan.yml/badge.svg
[njs-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/njsscan.yml
[osv-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/osv-scanner.yml/badge.svg
[osv-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/osv-scanner.yml
[ctr-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/container.yml/badge.svg
[ctr-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/container.yml
[scr-b]: https://api.securityscorecards.dev/projects/github.com/anchit-choudhry/app-drawer/badge
[scr-l]: https://scorecard.dev/viewer/?uri=github.com/anchit-choudhry/app-drawer
[exp-b]: https://img.shields.io/badge/Express.js-%23404d59.svg?logo=express&logoColor=%2361DAFB
[exp-l]: https://expressjs.com/
[gha-b]: https://img.shields.io/badge/GitHub_Actions-2088FF?logo=github-actions&logoColor=white
[gha-l]: https://github.com/features/actions
