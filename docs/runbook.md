# Runbook

Day-to-day operation of `express-static-serve`: deploying a build, rolling back, changing a setting,
and reading symptoms. Settings and their accepted values are in the [README](../README.md).

## Deploy a new build

1. Replace the contents of `packages/express-static-serve/dist/` in one step, not in place.
2. Run `npm run prepare-dist --workspace=express-static-serve`. It writes the compressed variants
   and the manifest, then checks the layout and the CSP. Any finding fails it; fix the build and
   run it again.
3. Reload the workers from the ecosystem file (see "Change a setting under PM2"). The static
   layer lists the variants once at startup, so a reload is needed for added or renamed files.
4. Confirm the build id (see "Confirm which build is live").

## Roll back

Put the previous build back into `dist/`, then repeat the deploy steps. `precompress` skips files
whose content did not change, so the run is quick. There is no state outside `dist/`, so a roll
back is only a deploy of an older build.

## Change a setting under PM2

A reload from the ecosystem file applies only the file's `env` block. A variable that is not
exported on the reload goes back to its default, so export every non-default value each time:

```bash
LOG_FORMAT=json TRUST_PROXY=1 npx pm2 reload packages/express-static-serve/ecosystem.config.js
```

A bad value stops the reload in the terminal and leaves the running workers alone. Never reload
by app name with `--update-env`: it skips the file and hands the shell environment to the workers.

## Run in Docker

```bash
docker run --init --read-only --cap-drop=ALL -p 3000:3000 \
  -v "$PWD/packages/express-static-serve/dist:/app/packages/express-static-serve/dist:ro" \
  app-drawer
```

Pass settings with `-e NAME=value`. The image has one process and no PM2, so restart the container
after changing `dist/`. The container platform owns replicas and restarts.

## Confirm which build is live

At startup the server logs `Serving dist build <12 hex characters>`, taken from the manifest.
Read it with `npm run logs:express-static-serve` (PM2 instance 0 logs it once). The id is the first
12 characters of the SHA-256 of `dist/.dist-manifest.json`, so `shasum -a 256` on that file names
the build that should be live. A `dist/` without a manifest logs that it has none and that files
are served uncompressed.

## Symptoms

| Symptom                                   | Likely cause and fix                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| Every path except `GET /` answers 404     | `dist/` is missing or empty; check the startup warning        |
| Files are served uncompressed             | No manifest, or files added after `prepare-dist`; run it again |
| "Refused to..." in the browser console    | The CSP blocked something; run `check-csp` on `dist/`         |
| `GET /` answers 503 `DRAINING`            | The server is shutting down; see `SHUTDOWN_GRACE_MS`          |
| The server exits at start with "Invalid"  | A bad variable; the message names it and the accepted values  |
| PM2 workers in the `errored` state        | Reloaded by app name with `--update-env`; reload from the file |
| A new page does not show                  | HTML is `no-cache`, so look at the CDN or proxy in front      |

## See also

- [Architecture](architecture.md) for how the pieces fit.
- [Threat model](threat-model.md) for what the controls defend against.
- [Decision records](adr/README.md) for the reasons behind the rules above.
