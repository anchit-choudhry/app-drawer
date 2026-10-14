# App Drawer

[![Apache License 2.0][lic-b]][lic-l]
[![CI][ci-b]][ci-l]
[![CodeQL][cql-b]][cql-l]
[![DevSkim][dvs-b]][dvs-l]
[![Lint Code Base][lnt-b]][lnt-l]
[![Microsoft Defender For Devops](https://github.com/anchit-choudhry/app-drawer/actions/workflows/defender-for-devops.yml/badge.svg)](https://github.com/anchit-choudhry/app-drawer/actions/workflows/defender-for-devops.yml)
[![njsscan][njs-b]][njs-l]
[![OSSAR][oss-b]][oss-l]
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

| Variable               | Default | Purpose                                                |
| ---------------------- | ------- | ------------------------------------------------------ |
| `PORT`                 | `3000`  | HTTP port                                              |
| `NODE_ENV`             | unset   | `development` shows error details on the 500 page      |
| `VERIFY_DIST_ON_START` | unset   | `true` runs `verify-dist` at startup and logs problems |

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

`GET /` returns `{ "status": "UP" }`. It does not check that `dist/` exists.

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

To deliver a new build:

1. Replace the contents of `dist/` in one step rather than editing it in place.
2. Run `npm run prepare-dist --workspace=express-static-serve` to write the compressed variants
   and verify them.
3. Restart the workers (for example `npx pm2 reload express-static-serve`). The server lists the
   compressed variants once at startup, so added, removed, or renamed variants are only picked up
   after a restart. Set `VERIFY_DIST_ON_START=true` to re-run the check at each boot.

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
[oss-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/ossar.yml/badge.svg
[oss-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/ossar.yml
[osv-b]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/osv-scanner.yml/badge.svg
[osv-l]: https://github.com/anchit-choudhry/app-drawer/actions/workflows/osv-scanner.yml
[exp-b]: https://img.shields.io/badge/Express.js-%23404d59.svg?logo=express&logoColor=%2361DAFB
[exp-l]: https://expressjs.com/
[gha-b]: https://img.shields.io/badge/GitHub_Actions-2088FF?logo=github-actions&logoColor=white
[gha-l]: https://github.com/features/actions
