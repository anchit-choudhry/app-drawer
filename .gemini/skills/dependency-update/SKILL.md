---
name: dependency-update
description: Checks for outdated npm dependencies across the app-drawer workspace, referring to the workflow in .claude/skills/dependency-update/SKILL.md.
---

# Dependency Update Skill

This skill mirrors the workflow defined in [.claude/skills/dependency-update/SKILL.md](../../../.claude/skills/dependency-update/SKILL.md).

## Workflow Reference

1. **Check**: `npm outdated`
2. **Review**: Present to user.
3. **Select**: User chooses updates.
4. **Apply**: `npm update` (the root `.npmrc` sets `min-release-age=7`, so releases under 7 days
   old are skipped; for an urgent security fix add `--min-release-age=0` to that one command and
   tell the user why)
5. **Audit**: `npm audit` & `npm audit fix` (no `--force`)
6. **Verify**: `npm test` from the root, then `node packages/express-static-serve/server.js` and
   check `GET /` (a `dist/ not found` startup warning is expected without a `dist/`).

For detailed steps and commands, see [.claude/skills/dependency-update/SKILL.md](../../../.claude/skills/dependency-update/SKILL.md).
