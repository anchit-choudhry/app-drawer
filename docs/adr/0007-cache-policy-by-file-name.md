# 0007: Cache policy by file name, with a hex-only hash rule

## Status

Accepted.

## Context

A static site wants long caching for assets and fast updates for pages, but the server does not
build the site, so it cannot know which files are versioned. A blanket long policy would keep old
pages alive in caches, and a blanket short one wastes bandwidth.

## Decision

`lib/cache-policy.js` gives each file one of three policies by its name, judged without the
compression extension. HTML is `no-cache`. A name with 8 or more lower-case hex characters after
`.` or `-`, holding a digit and a letter `a` to `f`, then one or two extensions, is
`public, max-age=31536000, immutable`. Everything else keeps the 2 hour policy. `GET /` and every
error page are `no-store`, and a response with no policy of its own is `no-cache`.

## Consequences

- Dates, words, and digit-only or letter-only runs do not count as hashes.
- Build tools that write mixed-case hashes never match, so their files get the 2 hour policy.
  That is safe; it only costs cache hits.
- Widening the `immutable` rule is a review item, because a wrong match caches a changing file for
  a year.

## See also

- [README](../../README.md), "Providing dist" for the user-facing table.
