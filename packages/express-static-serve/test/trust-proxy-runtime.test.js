const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { cleanEnv, serverPath, startServer, waitForOutput, httpGet } = require("./helpers");

const socketAddress = /^(::1|(::ffff:)?127\.0\.0\.1) /m;

// Starts the real server, sends one request, and returns what Morgan logged for it. Morgan only
// reads the client IP, so its access line is where the trust setting becomes visible.
async function accessLogFor(env, headers) {
  const server = await startServer({ env });
  try {
    await httpGet(server.port, "/", headers);
    await waitForOutput(server, /"GET \/ HTTP/, "the access log line");
    return server.stdout;
  } finally {
    await server.stop();
  }
}

describe("TRUST_PROXY at runtime", () => {
  test("one trusted hop logs the address the proxy appended, not a spoofed one", async () => {
    const log = await accessLogFor(
      { TRUST_PROXY: "1" },
      { "X-Forwarded-For": "198.51.100.7, 203.0.113.9" }
    );
    assert.match(log, /^203\.0\.113\.9 /m);
    assert.doesNotMatch(log, /^198\.51\.100\.7 /m);
  });

  test("by default no proxy is trusted, so the socket address is logged", async () => {
    const log = await accessLogFor({}, { "X-Forwarded-For": "203.0.113.9" });
    assert.match(log, socketAddress);
    assert.doesNotMatch(log, /^203\.0\.113\.9 /m);
  });

  test("a bad value stops the server before it listens and names the value", () => {
    const result = spawnSync(process.execPath, [serverPath], {
      env: { ...cleanEnv(), TRUST_PROXY: "true", PORT: "0" },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TRUST_PROXY/);
    assert.match(result.stderr, /"true"/);
    assert.doesNotMatch(result.stdout, /Server Established/);
  });
});
