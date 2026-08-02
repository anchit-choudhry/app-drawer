---
name: dependency-update
description: Checks for outdated npm dependencies across the app-drawer workspace (root and
  packages/express-static-serve), facilitates user-guided updates, and verifies the project
  still starts cleanly and passes npm audit afterward.
---

# Dependency Update Skill

Codifies the workflow already described in this repo's CLAUDE.md ("Security & Maintenance")
into a repeatable process. Covers the npm workspace as a whole - there is only one package today
(`express-static-serve`), but this runs from the repo root so it picks up new packages under
`packages/*` automatically.

## Workflow

1. **Check for updates**: Run `npm outdated` from the repo root.
2. **User review**: Present the outdated packages (current, wanted, latest) to the user.
3. **Selection**: Ask the user which packages to update and which to skip. Do not upgrade major
   versions without explicit confirmation, since a major bump can break the Express 5 /
   express-static-gzip / Helmet integration.
4. **Apply updates**: Run `npm update <package1> <package2> ...` for the selected packages (scoped
   to the correct workspace if the package isn't at the root).
5. **Audit**: Run `npm audit`. If vulnerabilities remain, run `npm audit fix` - never
   `npm audit fix --force`, per CLAUDE.md.
6. **Verify**: Start the server locally (`cd packages/express-static-serve && node server.js`)
   and confirm `GET /` returns `{ "status": "UP" }` before considering the update complete.

## Commands

- `npm outdated`: Check for available updates.
- `npm update [packages...]`: Update selected packages.
- `npm audit`: Check for known vulnerabilities.
- `npm audit fix`: Fix vulnerabilities automatically (never with `--force`).
- `node packages/express-static-serve/server.js`: Verify the server still starts and serves
  `GET /` correctly after updates.
