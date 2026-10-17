---
name: dependency-update
description: Checks for outdated npm dependencies across the app-drawer workspace (root and
  packages/express-static-serve), facilitates user-guided updates, and verifies the project
  still starts cleanly and passes npm audit afterward.
---

# Dependency Update Skill

Codifies the workflow already described in this repo's CLAUDE.md ("Security & Maintenance")
into a repeatable process. Covers the npm workspace as a whole - there is only one package today
(`express-static-serve`), but this runs from the repository root so it picks up new packages under
`packages/*` automatically.

## Workflow

1. **Check Dependabot first**: Dependabot already opens weekly PRs for npm packages and GitHub
   Actions (with a 7-day cooldown matching `min-release-age`). Look at the open Dependabot PRs
   before bumping by hand so the same update is not made twice. This skill does not touch
   `.github/workflows/` action pins; Dependabot owns those.
2. **Check for updates**: Run `npm outdated` from the repository root.
3. **User review**: Present the outdated packages (current, wanted, latest) to the user.
4. **Selection**: Ask the user which packages to update and which to skip. Do not upgrade major
   versions without explicit confirmation, since a major bump can break the Express 5 /
   express-static-gzip / Helmet integration.
5. **Apply updates**: Run `npm update <package1> <package2> ...` for the selected packages (scoped
   to the correct workspace if the package isn't at the root). The root `.npmrc` sets
   `min-release-age=7`, so releases under 7 days old are skipped; for an urgent security fix, add
   `--min-release-age=0` to that one command and tell the user why.
6. **Audit**: Run `npm audit`. If vulnerabilities remain, run `npm audit fix` - never
   `npm audit fix --force`, per CLAUDE.md. `braces` is expected to remain (no fix exists).
7. **Review overrides**: The root `package.json` `overrides` (`js-yaml`, `basic-ftp`) exist only
   because `pm2` pins vulnerable transitive versions (see CLAUDE.md, "Transitive vulnerability
   overrides"). If the update moved `pm2`, check with `npm view pm2@<version> dependencies` and
   `npm ls js-yaml basic-ftp` whether an override is no longer needed, and remove it if so.
8. **Verify**: Run `npm run test:coverage --workspace=express-static-serve` (the same gate CI
   uses), `npm run audit:signatures`, and `npm ci --dry-run` (confirms `package.json` and
   `package-lock.json` still agree). Then start the server locally
   (`cd packages/express-static-serve && node server.js`) and confirm `GET /` returns
   `{ "status": "UP" }` before considering the update complete. Without a `dist/` directory the
   server prints a `dist/ not found` warning at startup; that is expected here and is not a
   failure.

## Commands

- `npm outdated`: Check for available updates.
- `npm update [packages...]`: Update selected packages.
- `npm audit`: Check for known vulnerabilities.
- `npm audit fix`: Fix vulnerabilities automatically (never with `--force`).
- `npm view <package> [field]`: Inspect registry metadata, such as a package's dependencies.
- `npm ci --dry-run`: Confirm the lockfile is in sync without installing anything.
- `npm run audit:signatures`: Verify registry signatures and provenance attestations.
- `npm run test:coverage --workspace=express-static-serve`: Tests plus the coverage gate.
- `npm test`: Run every workspace's tests (from the repository root).
- `node packages/express-static-serve/server.js`: Verify the server still starts and serves
  `GET /` correctly after updates.
