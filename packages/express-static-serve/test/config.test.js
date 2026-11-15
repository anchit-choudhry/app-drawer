const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  loadConfig,
  toEnv,
  ENV_NAMES,
  SHUTDOWN_TIMEOUT_MS,
  NODE_KEEP_ALIVE_TIMEOUT_MS,
  NODE_HEADERS_TIMEOUT_MS,
} = require("../lib/config");

const rejects = (env, pattern = /Invalid/) => assert.throws(() => loadConfig(env), pattern);

// A small seeded generator (mulberry32), so a failure can be reproduced. No Math.random.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("defaults", () => {
  test("loadConfig({}) gives the documented defaults", () => {
    assert.deepEqual(
      { ...loadConfig({}) },
      {
        port: 3000,
        trustProxy: 0,
        verifyDistOnStart: false,
        logFormat: "combined",
        logHealthChecks: true,
        keepAliveTimeoutMs: undefined,
        headersTimeoutMs: undefined,
        shutdownGraceMs: 0,
      }
    );
  });

  test("an empty string behaves like unset for every variable", () => {
    const empty = Object.fromEntries(ENV_NAMES.map((name) => [name, ""]));
    assert.deepEqual({ ...loadConfig(empty) }, { ...loadConfig({}) });
  });

  test("the forced-exit timer stays at 10 seconds", () => {
    assert.equal(SHUTDOWN_TIMEOUT_MS, 10000);
  });
});

describe("PORT", () => {
  test("accepts 0, 1, and 65535", () => {
    for (const value of ["0", "1", "65535"]) {
      assert.equal(loadConfig({ PORT: value }).port, Number(value));
    }
  });

  const bad = [
    "abc",
    "-1",
    "65536",
    " 3000",
    "3000 ",
    "1e3",
    "03000",
    "3000.0",
    "+80",
    "0x50",
    "3000\n",
    "12345678901234567890",
  ];
  for (const value of bad) {
    test(`rejects ${JSON.stringify(value)}, naming the variable and quoting the value`, () => {
      rejects({ PORT: value }, (error) => {
        assert.ok(error.message.startsWith(`Invalid PORT ${JSON.stringify(value)}`));
        return true;
      });
    });
  }
});

describe("flags and choices", () => {
  test("VERIFY_DIST_ON_START and LOG_HEALTH_CHECKS accept only true and false", () => {
    assert.equal(loadConfig({ VERIFY_DIST_ON_START: "true" }).verifyDistOnStart, true);
    assert.equal(loadConfig({ VERIFY_DIST_ON_START: "false" }).verifyDistOnStart, false);
    assert.equal(loadConfig({ LOG_HEALTH_CHECKS: "false" }).logHealthChecks, false);
    for (const value of ["1", "yes", "TRUE"]) {
      rejects({ VERIFY_DIST_ON_START: value }, /Invalid VERIFY_DIST_ON_START/);
      rejects({ LOG_HEALTH_CHECKS: value }, /Invalid LOG_HEALTH_CHECKS/);
    }
  });

  test("LOG_FORMAT accepts combined and json only", () => {
    assert.equal(loadConfig({ LOG_FORMAT: "json" }).logFormat, "json");
    assert.equal(loadConfig({ LOG_FORMAT: "combined" }).logFormat, "combined");
    rejects({ LOG_FORMAT: "dev" }, /Invalid LOG_FORMAT/);
  });

  test("TRUST_PROXY still goes through parseTrustProxy", () => {
    assert.equal(loadConfig({ TRUST_PROXY: "2" }).trustProxy, 2);
    rejects({ TRUST_PROXY: "true" }, /TRUST_PROXY/);
  });
});

describe("timeouts", () => {
  test("keep-alive accepts 1000 to 300000 and headers accepts 1000 to 600000", () => {
    assert.equal(loadConfig({ KEEP_ALIVE_TIMEOUT_MS: "1000" }).keepAliveTimeoutMs, 1000);
    const top = { KEEP_ALIVE_TIMEOUT_MS: "300000", HEADERS_TIMEOUT_MS: "600000" };
    assert.equal(loadConfig(top).keepAliveTimeoutMs, 300000);
    assert.equal(loadConfig(top).headersTimeoutMs, 600000);
    assert.equal(loadConfig({ HEADERS_TIMEOUT_MS: "6000" }).headersTimeoutMs, 6000);
  });

  test("one value below and one above each range is rejected", () => {
    rejects({ KEEP_ALIVE_TIMEOUT_MS: "999" }, /Invalid KEEP_ALIVE_TIMEOUT_MS/);
    rejects(
      { KEEP_ALIVE_TIMEOUT_MS: "300001", HEADERS_TIMEOUT_MS: "600000" },
      /Invalid KEEP_ALIVE_TIMEOUT_MS/
    );
    rejects({ HEADERS_TIMEOUT_MS: "999" }, /Invalid HEADERS_TIMEOUT_MS/);
    rejects({ HEADERS_TIMEOUT_MS: "600001" }, /Invalid HEADERS_TIMEOUT_MS/);
  });

  test("SHUTDOWN_GRACE_MS accepts 0 to 9000", () => {
    assert.equal(loadConfig({ SHUTDOWN_GRACE_MS: "0" }).shutdownGraceMs, 0);
    assert.equal(loadConfig({ SHUTDOWN_GRACE_MS: "9000" }).shutdownGraceMs, 9000);
    rejects({ SHUTDOWN_GRACE_MS: "9001" }, /Invalid SHUTDOWN_GRACE_MS/);
    rejects({ SHUTDOWN_GRACE_MS: "-1" }, /Invalid SHUTDOWN_GRACE_MS/);
  });

  test("the headers timeout must exceed the keep-alive timeout", () => {
    // A long keep-alive alone leaves Node's own 60000 headers timeout below it.
    rejects(
      { KEEP_ALIVE_TIMEOUT_MS: "65000" },
      /HEADERS_TIMEOUT_MS \(60000\) must be greater than KEEP_ALIVE_TIMEOUT_MS \(65000\)/
    );
    const both = loadConfig({ KEEP_ALIVE_TIMEOUT_MS: "65000", HEADERS_TIMEOUT_MS: "66000" });
    assert.equal(both.keepAliveTimeoutMs, 65000);
    assert.equal(both.headersTimeoutMs, 66000);
    rejects({ HEADERS_TIMEOUT_MS: "5000" }, /\(5000\) must be greater than .*\(5000\)/);
    assert.equal(loadConfig({ HEADERS_TIMEOUT_MS: "5001" }).headersTimeoutMs, 5001);
    rejects({ KEEP_ALIVE_TIMEOUT_MS: "70000", HEADERS_TIMEOUT_MS: "70000" });
    assert.equal(loadConfig({ KEEP_ALIVE_TIMEOUT_MS: "1000" }).keepAliveTimeoutMs, 1000);
  });

  test("the assumed Node defaults equal Node's own", () => {
    const server = http.createServer();
    assert.equal(NODE_KEEP_ALIVE_TIMEOUT_MS, server.keepAliveTimeout);
    assert.equal(NODE_HEADERS_TIMEOUT_MS, server.headersTimeout);
  });
});

describe("toEnv and the result", () => {
  test("toEnv gives a string for every name, with an empty string for the two timeouts", () => {
    const env = toEnv(loadConfig({}));
    assert.deepEqual(Object.keys(env), ENV_NAMES);
    for (const value of Object.values(env)) {
      assert.equal(typeof value, "string");
    }
    assert.equal(env.KEEP_ALIVE_TIMEOUT_MS, "");
    assert.equal(env.HEADERS_TIMEOUT_MS, "");
    assert.equal(env.PORT, "3000");
  });

  test("loadConfig(toEnv(config)) gives the same config back", () => {
    for (const source of [
      {},
      { PORT: "0", LOG_FORMAT: "json", TRUST_PROXY: "3" },
      { KEEP_ALIVE_TIMEOUT_MS: "65000", HEADERS_TIMEOUT_MS: "66000", SHUTDOWN_GRACE_MS: "900" },
    ]) {
      const config = loadConfig(source);
      assert.deepEqual(loadConfig(toEnv(config)), config);
    }
  });

  test("the result is frozen", () => {
    assert.ok(Object.isFrozen(loadConfig({})));
  });
});

describe("random input", () => {
  const alphabet = "0123456789-+. eExX\n\t,abcdef";
  const next = seeded(20261111);
  const samples = Array.from({ length: 500 }, () => {
    const length = Math.floor(next() * 9);
    return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
  });

  test("PORT either throws or yields an integer from 0 to 65535", () => {
    for (const sample of samples) {
      try {
        const { port } = loadConfig({ PORT: sample });
        assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535, JSON.stringify(sample));
      } catch (error) {
        assert.match(error.message, /^Invalid PORT/, JSON.stringify(sample));
      }
    }
  });

  test("TRUST_PROXY either throws or yields an integer from 0 to 10", () => {
    for (const sample of samples) {
      try {
        const { trustProxy } = loadConfig({ TRUST_PROXY: sample });
        const inRange = Number.isInteger(trustProxy) && trustProxy >= 0 && trustProxy <= 10;
        assert.ok(inRange, JSON.stringify(sample));
      } catch (error) {
        assert.match(error.message, /^Invalid TRUST_PROXY/, JSON.stringify(sample));
      }
    }
  });
});
