---
name: dependency-update
description: Checks for outdated npm dependencies across the app-drawer workspace, referring to
  the workflow in .claude/skills/dependency-update/SKILL.md.
---

# Dependency Update Skill

This skill mirrors the workflow defined in [.claude/skills/dependency-update/SKILL.md][full].

## Workflow Reference

1. **Dependabot**: Check the open Dependabot PRs first so the same update is not made twice.
2. **Check**: `npm outdated`
3. **Review**: Present to user.
4. **Select**: User chooses updates.
5. **Apply**: `npm update` (the root `.npmrc` sets `min-release-age=7`, so releases under 7 days
   old are skipped; for an urgent security fix add `--min-release-age=0` to that one command and
   tell the user why)
6. **Audit**: `npm audit` & `npm audit fix` (no `--force`)
7. **Overrides**: Re-check the root `overrides` (`js-yaml`, `basic-ftp`) and drop any that `pm2`
   no longer needs.
8. **Verify**: `npm run test:coverage --workspace=express-static-serve`,
   `npm run audit:signatures`, `npm ci --dry-run`, then
   `node packages/express-static-serve/server.js` and check `GET /` (a `dist/ not found` startup
   warning is expected without a `dist/`).

For detailed steps and commands, see [.claude/skills/dependency-update/SKILL.md][full].

[full]: ../../../.claude/skills/dependency-update/SKILL.md
