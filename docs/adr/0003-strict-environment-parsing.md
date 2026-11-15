# 0003: Environment variables are parsed strictly and fail closed

## Status

Accepted.

## Context

Express and Node accept loose values, and some of them are dangerous. `TRUST_PROXY=true` means
"trust every hop", which lets any visitor choose the logged client address. A typo such as
`LOG_FORMAT=jsn` that silently falls back hides a mistake until it matters.

## Decision

`lib/config.js` parses every variable through `loadConfig`. An empty value counts as unset, and
anything else that is not an accepted value throws and stops the server before it listens.
Numbers are whole numbers in a stated range, with no sign, decimal, space, or leading zero. The
headers timeout must exceed the keep-alive timeout, and an unset one counts as Node's default.
`ecosystem.config.js` runs the same parser, so a bad value also stops `pm2 start` and a reload.

## Consequences

- A bad setting is a failed start, which an operator sees at once, not a surprise in production.
- Every new variable needs the parser, the README table, and `AGENTS.md`; `docs-drift.test.js`
  enforces the README part.
- `NODE_ENV` is the exception: it is free-form, and only `development` changes anything.

## See also

- [Threat model](../threat-model.md), rows 4 and 13.
