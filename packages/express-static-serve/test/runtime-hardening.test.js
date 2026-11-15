const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { clearConfigEnv, makeDist, removeDir, startServer, httpGet } = require("./helpers");

// The ecosystem file is loaded in this process, so a variable exported in the developer's shell
// must not reach the env block these tests start workers with.
clearConfigEnv();
const ecosystem = require("../ecosystem.config");

const [appConfig] = ecosystem.apps;
const fixtureName = "runtime-hardening.txt";
const fixtureContent = "served under the permission model";

test("still serves files, error pages, and health checks under the PM2 node_args", async () => {
  const distDir = makeDist({ [fixtureName]: fixtureContent });
  let server;

  try {
    // The exact flags the PM2 config gives its workers, so a flag that breaks the server
    // (for example a missing read grant) fails here and not only at deploy time.
    assert.ok(Array.isArray(appConfig.node_args), "ecosystem.config.js must define node_args");
    server = await startServer({ distDir, nodeArgs: appConfig.node_args });

    const health = await httpGet(server.port, "/");
    assert.equal(health.status, 200);
    assert.match(health.body, /UP/);

    const file = await httpGet(server.port, `/${fixtureName}`);
    assert.equal(file.status, 200);
    assert.equal(file.body, fixtureContent);

    const missing = await httpGet(server.port, "/does-not-exist");
    assert.equal(missing.status, 404);
    assert.match(missing.body, /Cannot find/);
  } finally {
    if (server) {
      await server.stop();
    }
    removeDir(distDir);
  }
});

// Every other test here starts the server through start(). This one runs server.js itself, the
// way PM2 and the Docker image do, so the `require.main === module` line is covered under the
// same flags. It needs no dist/: the health check answers without one.
test("server.js itself starts and answers the health check under the PM2 node_args", async () => {
  const server = await startServer({ main: true, nodeArgs: appConfig.node_args });
  try {
    const health = await httpGet(server.port, "/");
    assert.equal(health.status, 200);
    assert.match(health.body, /UP/);
  } finally {
    await server.stop();
  }
});

// A compressed variant that cannot be opened must not leave the file's headers on the error
// page: it is HTML, not brotli-encoded JavaScript, and it must not be cached.
test("an unreadable compressed variant gives a clean, uncached error page", async () => {
  const distDir = makeDist({
    "app.js": "console.log(1);\n".repeat(100),
    "app.js.br": zlib.brotliCompressSync("console.log(1);\n".repeat(100)),
  });
  try {
    fs.chmodSync(path.join(distDir, "app.js.br"), 0o000);
    const server = await startServer({ distDir, nodeArgs: appConfig.node_args });
    try {
      const res = await httpGet(server.port, "/app.js", { "Accept-Encoding": "br" });
      assert.equal(res.status, 500);
      assert.equal(res.headers["content-encoding"], undefined);
      assert.match(res.headers["content-type"], /^text\/html/);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.match(res.body, /An error occurred!/);
    } finally {
      await server.stop();
    }
  } finally {
    removeDir(distDir);
  }
});

// Starts the server the way a PM2 worker is started (same node_args and env block, plus any
// overrides), requests one path, stops it, and returns the response.
async function requestUnderPm2Env(envOverrides, distDir, urlPath) {
  const server = await startServer({
    distDir,
    nodeArgs: appConfig.node_args,
    // The launching shell exports NODE_ENV=development by mistake; the PM2 env block must win.
    // PORT comes after the block so that a free port is used and not the block's own value.
    env: { NODE_ENV: "development", ...appConfig.env, PORT: "0", ...envOverrides },
  });
  try {
    return await httpGet(server.port, urlPath);
  } finally {
    await server.stop();
  }
}

test("error pages show no stack under the PM2 env, but do under NODE_ENV=development", async () => {
  // Nothing in the app throws on its own, so make the static middleware fail for real: a
  // file that is listed and stat-able but cannot be opened is reported as a 500 and
  // forwarded to the error handler. Malformed paths such as /% never reach it.
  const distDir = makeDist({ [fixtureName]: fixtureContent });
  try {
    fs.chmodSync(path.join(distDir, fixtureName), 0o000);
    const urlPath = `/${fixtureName}`;

    const production = await requestUnderPm2Env({}, distDir, urlPath);
    assert.equal(production.status, 500, "the probe must reach the error handler");
    assert.match(production.body, /An error occurred!/);
    assert.doesNotMatch(production.body, /EACCES|<pre>/);

    // Control: the same request with the development override must show the stack, which
    // proves the probe really reaches the handler and the production result is not vacuous.
    const development = await requestUnderPm2Env({ NODE_ENV: "development" }, distDir, urlPath);
    assert.equal(development.status, 500);
    assert.match(development.body, /EACCES/);
    assert.match(development.body, /<pre>/);
  } finally {
    removeDir(distDir);
  }
});
