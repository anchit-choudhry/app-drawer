const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
// A TRUST_PROXY exported in the developer's shell must not change what these tests start.
delete process.env.TRUST_PROXY;
const ecosystem = require("../ecosystem.config");
const { startServer, httpGet } = require("./helpers");

const [appConfig] = ecosystem.apps;
const distDir = path.join(__dirname, "..", "dist");
const fixtureName = "runtime-hardening.txt";
const fixtureContent = "served under the permission model";
const port = 34566;

// A pre-built production dist/ (per CLAUDE.md) must never be touched by tests, so this
// scenario only runs when dist/ is genuinely absent.
const distPresent = fs.existsSync(distDir);

test(
  "the server still serves files, error pages, and health checks under the PM2 node_args",
  { skip: distPresent && "dist/ exists; cannot create a fixture safely" },
  async () => {
    let server;

    try {
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, fixtureName), fixtureContent);

      // The exact flags the PM2 config gives its workers, so a flag that breaks the server
      // (for example a missing read grant) fails here and not only at deploy time.
      assert.ok(Array.isArray(appConfig.node_args), "ecosystem.config.js must define node_args");
      server = await startServer({ port, nodeArgs: appConfig.node_args });

      const health = await httpGet(port, "/");
      assert.equal(health.status, 200);
      assert.match(health.body, /UP/);

      const file = await httpGet(port, `/${fixtureName}`);
      assert.equal(file.status, 200);
      assert.equal(file.body, fixtureContent);

      const missing = await httpGet(port, "/does-not-exist");
      assert.equal(missing.status, 404);
      assert.match(missing.body, /Cannot find/);
    } finally {
      if (server) {
        await server.stop();
      }
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  }
);

// Starts the server the way a PM2 worker is started (same node_args and env block, plus any
// overrides), requests one path, stops it, and returns the response.
async function requestUnderPm2Env(envOverrides, workerPort, urlPath) {
  const server = await startServer({
    port: workerPort,
    nodeArgs: appConfig.node_args,
    // The launching shell exports NODE_ENV=development by mistake; the PM2 env block must win.
    env: { NODE_ENV: "development", ...appConfig.env, ...envOverrides },
  });
  try {
    return await httpGet(workerPort, urlPath);
  } finally {
    await server.stop();
  }
}

test(
  "error pages show no stack trace under the PM2 env, and do under NODE_ENV=development",
  { skip: distPresent && "dist/ exists; cannot create a fixture safely" },
  async () => {
    try {
      fs.mkdirSync(distDir, { recursive: true });
      // Nothing in the app throws on its own, so make the static middleware fail for real: a
      // file that is listed and stat-able but cannot be opened is reported as a 500 and
      // forwarded to the error handler. Malformed paths such as /% never reach it.
      const unreadable = path.join(distDir, fixtureName);
      fs.writeFileSync(unreadable, fixtureContent);
      fs.chmodSync(unreadable, 0o000);
      const urlPath = `/${fixtureName}`;

      const production = await requestUnderPm2Env({}, 34576, urlPath);
      assert.equal(production.status, 500, "the probe must reach the error handler");
      assert.match(production.body, /An error occurred!/);
      assert.doesNotMatch(production.body, /EACCES|<pre>/);

      // Control: the same request with the development override must show the stack, which
      // proves the probe really reaches the handler and the production result is not vacuous.
      const development = await requestUnderPm2Env({ NODE_ENV: "development" }, 34577, urlPath);
      assert.equal(development.status, 500);
      assert.match(development.body, /EACCES/);
      assert.match(development.body, /<pre>/);
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  }
);
