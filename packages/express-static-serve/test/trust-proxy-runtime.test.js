const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { startServer, waitForOutput, httpGet } = require("./helpers");

// A TRUST_PROXY exported in the developer's shell must not change what these tests start.
delete process.env.TRUST_PROXY;

const serverPath = path.join(__dirname, "..", "server.js");
const socketAddress = /^(::1|(::ffff:)?127\.0\.0\.1) /m;

// Starts the real server, sends one request, and returns what Morgan logged for it. Morgan only
// reads the client IP, so its access line is where the trust setting becomes visible.
async function accessLogFor(env, port, headers) {
  const server = await startServer({ port, env });
  try {
    await httpGet(port, "/", headers);
    await waitForOutput(server, /"GET \/ HTTP/, "the access log line");
    return server.stdout;
  } finally {
    await server.stop();
  }
}

describe("TRUST_PROXY at runtime", () => {
  test("one trusted hop logs the address the proxy appended, not a spoofed one", async () => {
    const log = await accessLogFor({ TRUST_PROXY: "1" }, 34580, {
      "X-Forwarded-For": "198.51.100.7, 203.0.113.9",
    });
    assert.match(log, /^203\.0\.113\.9 /m);
    assert.doesNotMatch(log, /^198\.51\.100\.7 /m);
  });

  test("by default no proxy is trusted, so the socket address is logged", async () => {
    const log = await accessLogFor({}, 34581, { "X-Forwarded-For": "203.0.113.9" });
    assert.match(log, socketAddress);
    assert.doesNotMatch(log, /^203\.0\.113\.9 /m);
  });

  test("a bad value stops the server before it listens and names the value", () => {
    const result = spawnSync(process.execPath, [serverPath], {
      env: { ...process.env, TRUST_PROXY: "true", PORT: "34582" },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TRUST_PROXY/);
    assert.match(result.stderr, /"true"/);
    assert.doesNotMatch(result.stdout, /Server Established/);
  });
});
