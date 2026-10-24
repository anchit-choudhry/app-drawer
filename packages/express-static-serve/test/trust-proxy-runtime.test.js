const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const serverPath = path.join(__dirname, "..", "server.js");
const socketAddress = /^(::1|(::ffff:)?127\.0\.0\.1) /m;

// Environment for a server process that never inherits the caller's TRUST_PROXY.
const envWith = (extra, port) => {
  const env = { ...process.env, ...extra, PORT: String(port) };
  if (!("TRUST_PROXY" in extra)) {
    delete env.TRUST_PROXY;
  }
  return env;
};

const requestRoot = (port, headers) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/", headers }, (res) => {
        res.resume();
        res.on("end", resolve);
      })
      .on("error", reject);
  });

// Starts the real server, sends one request, and returns what Morgan logged for it. Morgan only
// reads the client IP, so its access line is where the trust setting becomes visible.
async function accessLogFor(extraEnv, port, headers) {
  const child = spawn(process.execPath, [serverPath], { env: envWith(extraEnv, port) });
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  const waitFor = (pattern, what) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = setInterval(() => {
        if (pattern.test(stdout)) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error(`${what} did not appear:\n${stdout}`));
        }
      }, 25);
    });

  try {
    await waitFor(/Server Established/, "startup line");
    await requestRoot(port, headers);
    await waitFor(/"GET \/ HTTP/, "access log line");
    return stdout;
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
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
      env: envWith({ TRUST_PROXY: "true" }, 34582),
      encoding: "utf8",
      timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TRUST_PROXY/);
    assert.match(result.stderr, /"true"/);
    assert.doesNotMatch(result.stdout, /Server Established/);
  });
});
