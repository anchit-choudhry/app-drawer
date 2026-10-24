# App Drawer

[![Apache License 2.0][lic-b]][lic-l]
[![CI][ci-b]][ci-l]
[![CodeQL][cql-b]][cql-l]
[![DevSkim][dvs-b]][dvs-l]
[![Lint Code Base][lnt-b]][lnt-l]
[![njsscan][njs-b]][njs-l]
[![OSV Scanner][osv-b]][osv-l]

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

Requires Node 22.15 or later (`.nvmrc` pins 24).

| Variable               | Default | Purpose                                                                  |
| ---------------------- | ------- | ------------------------------------------------------------------------ |
| `PORT`                 | `3000`  | HTTP port                                                                |
| `NODE_ENV`             | unset   | `development` shows error details on the 500 page; PM2 sets `production` |
| `TRUST_PROXY`          | `0`     | Reverse proxy hops to trust, 0 to 10; see "Running under PM2"            |
| `VERIFY_DIST_ON_START` | unset   | `true` runs `verify-dist` at startup and logs problems                   |

```bash
npm ci
npm test                             # all workspace tests
npm run test:coverage --workspace=express-static-serve
npm run precompress --workspace=express-static-serve   # write .zst/.br/.gz/.zz next to dist assets
npm run verify-dist --workspace=express-static-serve   # check index.html and variants
npm run prepare-dist --workspace=express-static-serve  # precompress, then verify-dist
npm run audit:signatures             # verify registry signatures and provenance
npm run start:express-static-serve   # PM2 cluster mode, one worker per CPU
npm run stop:express-static-serve
npm run logs:express-static-serve
```

For local development without PM2, run `node server.js` from `packages/express-static-serve/`.

`GET /` returns `{ "status": "UP" }` with `Cache-Control: no-store`, so a CDN cannot keep serving
a stale answer. It does not check that `dist/` exists.

### Running under PM2

`npm run start:express-static-serve` loads `ecosystem.config.js`, which starts the workers in
production mode and passes `TRUST_PROXY` to them. `TRUST_PROXY` is the number of reverse proxy or
CDN hops the server trusts when it works out a visitor's IP address, which only the access log
uses. It defaults to `0`, so no proxy is trusted. Set it to `1` once exactly one proxy or CDN sits
in front of the server.

The value is parsed strictly. Only an unset or empty value (meaning `0`) or a whole number from
`0` to `10` is accepted. `true`, `loopback`, signs, decimals, leading zeros, spaces, and larger
numbers stop the server and PM2 with an error that names the value, because Express would treat
`true` as "trust every hop" and let any visitor forge their address.

To change it, reload from the ecosystem file, which PM2 reads again:

```bash
TRUST_PROXY=1 npx pm2 reload packages/express-static-serve/ecosystem.config.js --update-env
```

Checked against PM2 7.0.4:

- A bad `TRUST_PROXY` on `pm2 start` or on a reload from the file stops in the terminal with an
  error naming the value. On a reload, the running workers are left alone.
- Reloading from the file with `TRUST_PROXY` unset sets it back to `0`.
- Workers keep `NODE_ENV=production` when the file is reloaded, even if your shell has exported
  `NODE_ENV=development`.
- **Do not reload by app name together with `--update-env`.** That form skips the file and hands
  your shell environment to the workers. A shell with `NODE_ENV=development` then turned error
  details on, and a bad `TRUST_PROXY` left every worker in the `errored` state, which is an
  outage.

### Providing `dist/`

`dist/` is git-ignored and built outside this repo on purpose. Whatever pipeline produces the
assets delivers them to `packages/express-static-serve/dist/`. The server expects:

- **`index.html` at the top level.** `verify-dist` fails without it. It is served at
  `/index.html`, not `/`, because `GET /` is reserved for the health check. A subfolder's
  `index.html` is served at `/subfolder/`.
- **No single-page-app fallback.** Unknown paths return the 404 page, so every route needs a real
  file (or use hash-based routing).
- **Long-lived caching.** Browsers cache files for 2 hours and shared caches for 4 hours, so use
  content-hashed file names for assets. A changed `index.html` can take that long to appear.

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

To relax any of these rules, edit the `helmet()` call in `server.js`, then run the
`express-security-reviewer` agent on the change.

To deliver a new build:

1. Replace the contents of `dist/` in one step rather than editing it in place.
2. Run `npm run prepare-dist --workspace=express-static-serve` to write the compressed variants
   and verify them.
3. Restart the workers by reloading from the ecosystem file (see "Running under PM2"). The server
   lists the compressed variants once at startup, so added, removed, or renamed variants are only
   picked up after a restart. Set `VERIFY_DIST_ON_START=true` to re-run the check at each boot.

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
[exp-b]: https://img.shields.io/badge/Express.js-%23404d59.svg?logo=express&logoColor=%2361DAFB
[exp-l]: https://expressjs.com/
[gha-b]: https://img.shields.io/badge/GitHub_Actions-2088FF?logo=github-actions&logoColor=white
[gha-l]: https://github.com/features/actions
