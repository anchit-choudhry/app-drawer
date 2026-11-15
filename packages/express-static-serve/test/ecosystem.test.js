const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { clearConfigEnv, cleanEnv } = require("./helpers");
// A variable exported in the developer's shell must not change what these tests load.
clearConfigEnv();
const { SHUTDOWN_TIMEOUT_MS } = require("../server");
const ecosystem = require("../ecosystem.config");

const [appConfig] = ecosystem.apps;
const packageDir = path.join(__dirname, "..");

// Loads ecosystem.config.js in a fresh process, as `pm2 start` does, with exactly the given
// variables set, and prints the env block entry called `name`.
function loadEcosystem(variables = {}, name = "TRUST_PROXY") {
  const env = { ...cleanEnv(), ...variables };
  const read = `require("./ecosystem.config").apps[0].env[${JSON.stringify(name)}]`;
  const script = `process.stdout.write(${read})`;
  return spawnSync(process.execPath, ["-e", script], { cwd: packageDir, env, encoding: "utf8" });
}

describe("PM2 worker environment", () => {
  test("starts workers in production mode", () => {
    assert.equal(appConfig.env.NODE_ENV, "production");
  });

  test("forwards TRUST_PROXY as 0 when it is unset", () => {
    const result = loadEcosystem({});
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "0");
  });

  test("forwards a valid TRUST_PROXY unchanged", () => {
    assert.equal(loadEcosystem({ TRUST_PROXY: "2" }).stdout, "2");
  });

  test("refuses to load with a bad TRUST_PROXY, so pm2 stops before any worker starts", () => {
    const result = loadEcosystem({ TRUST_PROXY: "true" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TRUST_PROXY/);
    assert.match(result.stderr, /"true"/);
  });
});

describe("PM2 worker environment, every supported variable", () => {
  test("forwards PORT as 3000 when it is unset", () => {
    assert.equal(loadEcosystem({}, "PORT").stdout, "3000");
  });

  test("forwards a given PORT", () => {
    assert.equal(loadEcosystem({ PORT: "8080" }, "PORT").stdout, "8080");
  });

  test("refuses to load with a bad PORT, naming the value", () => {
    const result = loadEcosystem({ PORT: "abc" }, "PORT");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid PORT "abc"/);
  });

  test("forwards an unset KEEP_ALIVE_TIMEOUT_MS as an empty string", () => {
    const result = loadEcosystem({}, "KEEP_ALIVE_TIMEOUT_MS");
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  test("forwards every supported variable, and nothing the config does not know", () => {
    const read = 'require("./ecosystem.config").apps[0].env';
    const script = `process.stdout.write(JSON.stringify(Object.keys(${read})))`;
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: packageDir,
      env: cleanEnv(),
      encoding: "utf8",
    });
    const { ENV_NAMES } = require("../lib/config");
    assert.deepEqual(JSON.parse(result.stdout), ["NODE_ENV", ...ENV_NAMES]);
  });
});

test("PM2 runs a single clustered app named express-static-serve", () => {
  assert.equal(ecosystem.apps.length, 1);
  assert.equal(appConfig.name, "express-static-serve");
  assert.equal(appConfig.exec_mode, "cluster");
  // 0 means one worker per CPU, matching the documented auto-scaling behavior.
  assert.equal(appConfig.instances, 0);
});

describe("PM2 worker runtime hardening", () => {
  const nodeArgs = appConfig.node_args ?? [];

  test("removes the Object.prototype.__proto__ accessor", () => {
    assert.ok(nodeArgs.includes("--disable-proto=delete"));
  });

  test("does not enable Node's permission model, which breaks PM2 cluster workers", () => {
    // Verified against PM2 7.0.4 on Node 24 and 26: workers crash at startup with ERR_ACCESS_DENIED
    // for the inspector API, and the only fix (--allow-inspector) lets a worker bypass the
    // model's restrictions, so enabling it here would add risk without adding isolation.
    const permissionFlags = nodeArgs.filter((arg) => /^--(permission|allow-)/.test(arg));
    assert.deepEqual(permissionFlags, []);
  });
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
