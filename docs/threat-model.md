# Threat model

What `express-static-serve` protects, where it trusts its surroundings, and which threats each
control answers. Each row names the test that fails if the control is removed.

## What is protected

- **The host:** only files under `dist/` (plus `dist/.well-known/`) may be read through the server.
- **Visitors:** pages are delivered with headers that limit scripts, framing, sniffing, and device
  features.
- **Operators:** the server fails at startup on a bad setting instead of running with a surprise,
  and its logs cannot be forged by a request.
- **The supply chain:** what is installed, built, and run in CI is pinned and checked.

## Trust boundaries

- **Visitor to server:** untrusted. The URL, method, and every header are hostile input.
- **Proxy or CDN to server:** trusted only for the number of hops in `TRUST_PROXY` (default 0).
- **Whoever delivers `dist/`:** trusted for content, checked for shape. The manifest finds
  accidents, not a writer who can also rewrite it.
- **Environment variables:** set by the operator, parsed strictly, never trusted as free text.

## Threats and mitigations

| #   | Threat                                    | Mitigation                                            | Guarded by                                                                 |
| --- | ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Reading files outside `dist/`             | Confinement by the static layer                       | `security-regression.test.js`, "path traversal"                            |
| 2   | Symlink out of `dist/`                    | `verify-dist` rejects symlinks; the server follows them | `security-regression.test.js`, "the server follows a symlink, which is why verify-dist rejects them" |
| 3   | Exposed dotfiles and manifest             | Dot paths never served; `verify-dist` rejects stray dot entries | `security-regression.test.js`, "hidden files"; `verify-dist.test.js` |
| 4   | Forged client address                     | Strict `TRUST_PROXY`, default 0                       | `trust-proxy-runtime.test.js`, "one trusted hop logs the address the proxy appended, not a spoofed one" |
| 5   | Script injection through a reflected URL  | Escaping in the views, and the CSP                    | `security-regression.test.js`, "reflected input"                           |
| 6   | XSS, clickjacking, type sniffing          | Helmet headers and `Permissions-Policy`               | `response-headers.test.js`, `security-headers.test.js`                     |
| 7   | Internal details on error pages           | Verbose errors fail closed; PM2 forces production     | `runtime-hardening.test.js`, "error pages show no stack under the PM2 env, but do under NODE_ENV=development" |
| 8   | Cached errors and stale content           | `no-store` on health and errors; `immutable` only for hex-hashed names | `error-handler.test.js`, "an error page is never cached"; `cache-policy.test.js` |
| 9   | Partial, stale, or changed deploy         | Manifest and `verify-dist`                            | `dist-manifest.test.js`; `verify-dist.test.js`                             |
| 10  | Pages that break under the CSP            | `check-csp` inside `prepare-dist`                     | `check-csp.test.js`; `prepare-dist.test.js`                                |
| 11  | Prototype pollution                       | `--disable-proto=delete` under PM2 and in the image   | `ecosystem.test.js`; `runtime-hardening.test.js`                           |
| 12  | Slow or abusive clients                   | Node timeouts, configurable; no bodies parsed         | `config.test.js`, "timeouts"; `startup.test.js`                            |
| 13  | Bad configuration                         | Strict parsing; nothing falls back silently           | `config.test.js`, "flags and choices"                                      |
| 14  | Compromised dependency or action          | No install scripts, release age, lockfile integrity, signatures, SHA and digest pins | `supply-chain.test.js`, "npm configuration" and "lockfile supply chain" |
| 15  | Script injection in workflows             | No `${{ }}` expression inside a `run:` script         | `supply-chain.test.js`                                                     |
| 16  | Container escape surface                  | Non-root user, read-only file system, no capabilities | `container-image.test.js`, "runs as a non-root numeric user in production mode" |
| 17  | Forged log lines                          | The JSON format escapes its values                    | `access-log.test.js`, "json format and control characters"                 |

Limits worth knowing:

- **Symlinks (row 2):** the server itself follows symlinks at runtime. Only `verify-dist` and
  `prepare-dist` reject them, so a link created after delivery is served.
- **Manifest (row 9):** it detects accidental or partial change, not a writer who can also rewrite
  it.
- **Slow clients (row 12):** there is no rate limiting. That belongs to the proxy or CDN.
- **Client address (row 4):** with `TRUST_PROXY` above the real hop count, a visitor can choose the
  logged address.
- **Client errors in the log:** a malformed URL answers 400 from `express-static-gzip`, and the
  server logs the full stack of client 4xx errors.

## Out of scope

- TLS termination, which the proxy or platform does.
- Authentication and authorization: every file under `dist/` is public.
- Rate limiting and denial of service protection.
- The content of `dist/`, apart from the shape checks and the CSP lint.

## See also

- [Architecture](architecture.md) for the stages that carry these controls.
- [Decision records](adr/README.md) for why the controls look like this.
- [Security policy](../.github/SECURITY.md) for reporting a vulnerability.
