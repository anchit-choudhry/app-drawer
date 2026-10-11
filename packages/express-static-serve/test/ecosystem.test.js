const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SHUTDOWN_TIMEOUT_MS } = require("../server");
const ecosystem = require("../ecosystem.config");

const [appConfig] = ecosystem.apps;

test("PM2 runs a single clustered app named express-static-serve", () => {
  assert.equal(ecosystem.apps.length, 1);
  assert.equal(appConfig.name, "express-static-serve");
  assert.equal(appConfig.exec_mode, "cluster");
  // 0 means one worker per CPU, matching the documented auto-scaling behavior.
  assert.equal(appConfig.instances, 0);
});

test("PM2 waits longer than the server's forced-exit timer before it sends SIGKILL", () => {
  // If kill_timeout were shorter, PM2 would SIGKILL a worker that is still draining
  // in-flight requests, which defeats the graceful shutdown handler in server.js.
  const { kill_timeout: killTimeout } = appConfig;
  assert.ok(
    killTimeout > SHUTDOWN_TIMEOUT_MS,
    `kill_timeout (${killTimeout}) must exceed SHUTDOWN_TIMEOUT_MS (${SHUTDOWN_TIMEOUT_MS})`
  );
});
