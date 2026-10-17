# Security policy

Please report security vulnerabilities privately so a fix can be prepared before details are public.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab, choose
**Report a vulnerability**, and describe the issue. Do not open a public issue or pull request for
a suspected vulnerability.

Please include:

- The affected component (for example `server.js`, a script under `scripts/`, or a workflow).
- Steps to reproduce, and the Node.js version you used.
- The impact you expect, such as information disclosure or denial of service.

Never include real secrets or credentials in a report.

## Supported versions

Only the latest commit on `main` is supported. Fixes are made there and not backported.

## Scope

In scope: the `express-static-serve` package, its helper scripts, and the GitHub workflows in this
repository. Vulnerabilities in third-party dependencies should be reported to the dependency's
maintainers; they are tracked here through Dependabot and `npm audit`.
