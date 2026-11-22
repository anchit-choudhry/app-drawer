const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { precompress } = require("../scripts/precompress");
const {
  cleanEnv,
  makeDist,
  removeDir,
  serverPath,
  startServer,
  waitForOutput,
  httpGet,
} = require("./helpers");

const page = "<!doctype html><title>app</title>\n".repeat(60);

// Starts the real server on a free port, waits until it is listening, stops it, and returns
// its output. Without `distDir` the server is pointed at a directory that does not exist.
async function runServer(env, distDir) {
  const server = await startServer({ distDir, env });
  await server.stop();
  return { stdout: server.stdout, stderr: server.stderr };
}

// Runs a scenario against a scratch dist/ and always removes it afterward.
async function withDist(files, scenario) {
  const distDir = makeDist(files);
  try {
    return await scenario(distDir);
  } finally {
    removeDir(distDir);
  }
}

// Runs a scenario against a scratch dist/ that prepare-dist has already processed.
async function withPreparedDist(files, scenario) {
  return withDist(files, async (distDir) => {
    precompress(distDir);
    return scenario(distDir);
  });
}

describe("missing dist/ warning", () => {
  test("warns at startup when dist/ is missing", async () => {
    const { stdout, stderr } = await runServer({});
    assert.match(stderr, /dist\/ not found/);
    // The warning is advisory: the server must still come up so GET / keeps working.
    assert.match(stdout, /Server Established/);
  });

  test("warns from the first PM2 worker (instance 0)", async () => {
    const { stderr } = await runServer({ NODE_APP_INSTANCE: "0" });
    assert.match(stderr, /dist\/ not found/);
  });

  test("stays quiet in other PM2 workers so the warning prints once per cluster", async () => {
    const { stdout, stderr } = await runServer({ NODE_APP_INSTANCE: "3" });
    assert.doesNotMatch(stderr, /dist\/ not found/);
    assert.match(stdout, /Server Established/);
  });
});

describe("opt-in dist verification at startup", () => {
  test("does nothing extra by default", async () => {
    await withDist({ "app.js": "console.log(1);" }, async (distDir) => {
      const { stderr } = await runServer({}, distDir);
      assert.doesNotMatch(stderr, /index\.html/);
    });
  });

  test("warns about each problem when VERIFY_DIST_ON_START=true, and still starts", async () => {
    await withDist({ "app.js": "console.log(1);" }, async (distDir) => {
      const { stdout, stderr } = await runServer({ VERIFY_DIST_ON_START: "true" }, distDir);
      assert.match(stderr, /dist verification found problems/);
      assert.match(stderr, /missing required file: index\.html/);
      assert.match(stdout, /Server Established/);
    });
  });

  test("is silent for a healthy dist/ when VERIFY_DIST_ON_START=true", async () => {
    await withPreparedDist({ "index.html": page }, async (distDir) => {
      const { stderr } = await runServer({ VERIFY_DIST_ON_START: "true" }, distDir);
      assert.doesNotMatch(stderr, /dist verification|missing required/);
    });
  });

  test("still starts and logs a warning when verification itself cannot run", async () => {
    const files = { "index.html": page, "index.html.br": zlib.brotliCompressSync(page) };
    await withDist(files, async (distDir) => {
      // A source file the server cannot read makes the deep check throw, as a permissions
      // problem or a file replaced mid-deploy would. express-static-gzip only lists file
      // names at startup, so the server itself can still run; the advisory check must not
      // be what takes it down.
      const source = path.join(distDir, "index.html");
      fs.chmodSync(source, 0o000);
      try {
        const env = { VERIFY_DIST_ON_START: "true" };
        const { stdout, stderr } = await runServer(env, distDir);
        assert.match(stderr, /dist verification could not run/);
        assert.match(stdout, /Server Established/);
      } finally {
        fs.chmodSync(source, 0o644);
      }
    });
  });

  test("shows a CSP finding as a warning with VERIFY_DIST_ON_START=true", async () => {
    const files = { "index.html": page + "<script>alert(1)</script>\n" };
    await withPreparedDist(files, async (distDir) => {
      const { stdout, stderr } = await runServer({ VERIFY_DIST_ON_START: "true" }, distDir);
      assert.match(stderr, /dist verification found problems/);
      assert.match(stderr, /index\.html:61: inline <script> \(blocked by script-src\)/);
      assert.match(stdout, /Server Established/);
    });
  });

  test("reports only from the first PM2 worker", async () => {
    await withDist({ "app.js": "console.log(1);" }, async (distDir) => {
      const env = { VERIFY_DIST_ON_START: "true", NODE_APP_INSTANCE: "2" };
      const { stderr } = await runServer(env, distDir);
      assert.doesNotMatch(stderr, /dist verification/);
    });
  });
});

describe("build id and manifest at startup", () => {
  test("a prepared dist/ logs its build id: 12 hex characters", async () => {
    await withPreparedDist({ "index.html": page }, async (distDir) => {
      const { stdout, stderr } = await runServer({}, distDir);
      assert.match(stdout, /^Serving dist build [0-9a-f]{12}$/m);
      assert.doesNotMatch(stderr, /no manifest/);
    });
  });

  test("the build id is the same for the same content and changes with it", async () => {
    const idOf = async (content) =>
      withPreparedDist({ "index.html": content }, async (distDir) => {
        const { stdout } = await runServer({}, distDir);
        return /Serving dist build ([0-9a-f]{12})/.exec(stdout)[1];
      });
    const first = await idOf(page);
    assert.equal(await idOf(page), first);
    assert.notEqual(await idOf(page + "<!-- changed -->\n"), first);
  });

  test("a dist/ without a manifest warns that files are served uncompressed", async () => {
    await withDist({ "index.html": page }, async (distDir) => {
      const { stdout, stderr } = await runServer({}, distDir);
      assert.match(stderr, /dist\/ has no manifest - run prepare-dist/);
      assert.doesNotMatch(stdout, /Serving dist build/);
      assert.match(stdout, /Server Established/);
    });
  });

  test("both lines come from the first PM2 worker only", async () => {
    await withPreparedDist({ "index.html": page }, async (distDir) => {
      const { stdout } = await runServer({ NODE_APP_INSTANCE: "2" }, distDir);
      assert.doesNotMatch(stdout, /Serving dist build/);
    });
    await withDist({ "index.html": page }, async (distDir) => {
      const { stderr } = await runServer({ NODE_APP_INSTANCE: "2" }, distDir);
      assert.doesNotMatch(stderr, /no manifest/);
    });
    await withPreparedDist({ "index.html": page }, async (distDir) => {
      const { stdout } = await runServer({ NODE_APP_INSTANCE: "0" }, distDir);
      assert.match(stdout, /Serving dist build/);
    });
  });
});

describe("listening", () => {
  test("a port that is already in use stops the server with the error", async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    try {
      const { port } = blocker.address();
      const result = spawnSync(process.execPath, [serverPath], {
        env: { ...cleanEnv(), PORT: String(port) },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.notEqual(result.status, 0, "the server must exit with an error");
      assert.match(result.stderr, /EADDRINUSE/);
      assert.doesNotMatch(result.stdout, /Server Established/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  test("the startup line reports the real port when PORT is 0", async () => {
    const server = await startServer({});
    try {
      assert.match(server.stdout, /PORT -> [1-9][0-9]*$/m);
    } finally {
      await server.stop();
    }
  });
});

describe("access log options reach the running server", () => {
  test("LOG_FORMAT=json writes one JSON object per request", async () => {
    const server = await startServer({ env: { LOG_FORMAT: "json" } });
    try {
      await httpGet(server.port, "/nothing-here");
      await waitForOutput(server, /"url":"\/nothing-here"/, "the JSON access line");
      const line = server.stdout.split("\n").find((text) => text.includes('"url":"/nothing-here"'));
      const entry = JSON.parse(line);
      assert.equal(entry.status, 404);
      assert.equal(entry.method, "GET");
    } finally {
      await server.stop();
    }
  });

  test("LOG_HEALTH_CHECKS=false leaves GET / out of the log and keeps other paths", async () => {
    const server = await startServer({ env: { LOG_HEALTH_CHECKS: "false" } });
    try {
      await httpGet(server.port, "/");
      await httpGet(server.port, "/marker");
      await waitForOutput(server, /"GET \/marker HTTP/, "the access line for /marker");
      assert.doesNotMatch(server.stdout, /"GET \/ HTTP/);
    } finally {
      await server.stop();
    }
  });
});

describe("timeouts reach the running server", () => {
  test("a headers timeout at or below the keep-alive timeout stops the server at start", () => {
    const result = spawnSync(process.execPath, [serverPath], {
      env: { ...cleanEnv(), PORT: "0", KEEP_ALIVE_TIMEOUT_MS: "65000" },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HEADERS_TIMEOUT_MS \(60000\) must be greater/);
    assert.doesNotMatch(result.stdout, /Server Established/);
  });
});

describe("shutdown", () => {
  test("SHUTDOWN_GRACE_MS keeps serving, answers 503 on the health check, exits 0", async () => {
    const server = await startServer({ env: { SHUTDOWN_GRACE_MS: "1500" } });
    try {
      const signalled = Date.now();
      server.child.kill("SIGTERM");
      // The signal arrives asynchronously and the handler sets the draining flag before it logs,
      // so wait for the log line: a request sent straight after kill can still see 200.
      await waitForOutput(server, /Received SIGTERM/, "the shutdown line");
      const health = await httpGet(server.port, "/");
      assert.equal(health.status, 503);
      assert.match(health.body, /DRAINING/);
      assert.equal(health.headers["cache-control"], "no-store");
      const result = await server.closed;
      assert.equal(result.code, 0);
      assert.ok(Date.now() - signalled >= 1400, "the server must wait out the grace period");
    } finally {
      server.child.kill("SIGKILL");
    }
  });

  test("two SIGTERM signals in a row still end with exit code 0", async () => {
    const server = await startServer({ env: { SHUTDOWN_GRACE_MS: "300" } });
    try {
      server.child.kill("SIGTERM");
      server.child.kill("SIGTERM");
      const result = await server.closed;
      assert.equal(result.code, 0);
    } finally {
      server.child.kill("SIGKILL");
    }
  });

  // server.close() only closes idle connections. A response still being sent when it runs keeps
  // its connection open afterwards, and with a long keep-alive timeout that held the process
  // until the forced exit (code 1).
  test(
    "a response still in flight when the server closes does not stall the exit",
    { timeout: 20000 },
    async () => {
      const distDir = makeDist({ "big.bin": "x".repeat(32 * 1024 * 1024) });
      const agent = new http.Agent({ keepAlive: true });
      const server = await startServer({ distDir, env: { KEEP_ALIVE_TIMEOUT_MS: "30000" } });
      try {
        const res = await new Promise((resolve, reject) => {
          const request = { host: "127.0.0.1", port: server.port, path: "/big.bin", agent };
          http.get(request, resolve).on("error", reject);
        });
        // Nothing reads the body, so the server is still sending it when it closes.
        res.pause();
        server.child.kill("SIGTERM");
        await waitForOutput(server, /Received SIGTERM/, "the shutdown line");
        // SHUTDOWN_GRACE_MS is 0, so close() runs right after the log line.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const resumed = Date.now();
        res.resume();
        const result = await server.closed;
        assert.equal(result.code, 0, `forced exit instead of a clean one:\n${server.stderr}`);
        assert.ok(Date.now() - resumed < 5000, "the exit must not wait for the keep-alive timeout");
      } finally {
        agent.destroy();
        server.child.kill("SIGKILL");
        removeDir(distDir);
      }
    }
  );

  // A missing dist/ only logs a warning, so this needs no fixture and runs even when a real
  // dist/ exists.
  test("SIGTERM shuts the server down gracefully", { timeout: 15000 }, async () => {
    const server = await startServer({ main: true });
    try {
      const result = await server.stop();
      assert.equal(result.code, 0);
    } finally {
      server.child.kill("SIGKILL");
    }
  });
});
