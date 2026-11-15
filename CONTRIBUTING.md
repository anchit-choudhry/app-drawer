# Contributing

Thanks for helping with App Drawer. This page covers setup, checks, style, and what a pull request
needs. The full guidance for coding agents is in [AGENTS.md](AGENTS.md), and it applies to people
too.

## Setup

1. Use Node 26: `nvm use` reads `.nvmrc`.
2. Run `npm ci` from the repository root. The `.npmrc` blocks dependency install scripts, so
   nothing runs during the install.

## Running the checks

Run these from the repository root:

```bash
npm test
npm run test:coverage --workspace=express-static-serve
npm run audit:signatures
```

- `npm test` runs every workspace's tests. They build their own scratch `dist/` fixtures and bind
  free ports, so they need no pre-built `dist/`.
- The coverage gate fails below 95% lines, 90% branches, or 85% functions.
- One test file: `npm test --workspace=express-static-serve -- test/server.test.js`.
- A test that starts the server uses `startServer` from `test/helpers.js`, never a fixed port, and
  anything it creates goes under `test/.tmp-*` and is removed afterwards.
- When a change to response headers is intended, update the recorded contract and review the diff:

  ```bash
  UPDATE_SNAPSHOTS=1 npm test --workspace=express-static-serve -- test/response-headers.test.js
  ```

## Style

- CommonJS, 2 spaces, LF line endings, double quotes, semicolons (see `.prettierrc.json`).
- A maximum line length of 100 characters.
- Hyphens only: never use en dashes or em dashes in code, documentation, or commit messages.
- A new environment variable needs `lib/config.js`, the README table, and `AGENTS.md`.
- Keep the middleware order: Helmet, Morgan, routes, static files, the 404 handler, the error
  handler.

## Commit messages

Use past participles: "Added", "Fixed", "Updated". For refactoring and formatting only, the one
line "Refactored and Formatted code" is fine.

## Pull request checklist

- [ ] `npm test` passes and the coverage gate passes.
- [ ] Documentation is updated, including the README table for a new variable.
- [ ] The middleware order is unchanged.
- [ ] A header contract diff, if there is one, was reviewed.

## Security reports

Do not open a public issue for a vulnerability. Follow the [security policy](.github/SECURITY.md).

## What this repository does not do

`dist/` is built outside this repository by design. Do not add a build step without opening an
issue first. See the [decision record](docs/adr/0001-dist-is-built-outside-the-repo.md).

## See also

- [README](README.md), [architecture](docs/architecture.md), and [runbook](docs/runbook.md).
- [Changelog](CHANGELOG.md).
