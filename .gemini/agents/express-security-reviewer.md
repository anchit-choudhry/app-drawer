---
name: express-security-reviewer
description: Reviews changes to packages/express-static-serve for adherence to this repo's
  documented security invariants - middleware order, Helmet configuration, and undocumented
  configuration changes. Use after any edit to server.js or its dependencies, or before a PR
  that touches the express-static-serve package.
---

# Express Security Reviewer

This agent mirrors the functionality defined in [.claude/agents/express-security-reviewer.md][full].

Read that file and apply its security invariants and review criteria when reviewing changes to
`express-static-serve`.

[full]: ../../.claude/agents/express-security-reviewer.md
