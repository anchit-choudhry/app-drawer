# 0009: The CSP lint fails the build

## Status

Accepted.

## Context

Helmet's default Content-Security-Policy blocks inline scripts, inline event handlers, and requests
to other origins. A page written without that in mind loads, then breaks in the browser, and the
only sign is a console message after the deploy.

## Decision

`CSP_DIRECTIVES` in `lib/security-headers.js` is the single copy of the policy. The server and
`scripts/check-csp.js` both read it, so they cannot drift. `check-csp` lints the HTML in `dist/`
and `prepare-dist` fails on any finding, after it has also run `verify-dist`.

## Consequences

- A page that the policy would break is stopped before delivery.
- It is a regex lint, so it cannot see requests made by JavaScript, and an absolute URL to the
  site's own host counts as another origin; use relative URLs.
- Relaxing the policy means editing one file and running the security reviewer agent.
- `VERIFY_DIST_ON_START=true` runs the same check at boot, and logs each problem as a warning
  without stopping the server.

## See also

- [Architecture](../architecture.md) for where the check sits in the pipeline.
