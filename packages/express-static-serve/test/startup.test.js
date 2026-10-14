const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const distDir = path.join(__dirname, "..", "dist");
const serverPath = path.join(__dirname, "..", "server.js");

// A pre-built production dist/ (per CLAUDE.md) must never be touched by tests, so these
// scenarios only run when dist/ is genuinely absent.
const distPresent = fs.existsSync(distDir);
const skip = distPresent && "dist/ exists; cannot simulate it safely";

const page = "<!doctype html><title>app</title>\n".repeat(60);

// Starts the real server, waits until it is listening, stops it, and returns its output.
async function runServer(env, port) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ...env, PORT: String(port) },
  });

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("Server Established")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`server exited early (${code}):\n${stderr}`));
    });
  });

  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
  return { stdout, stderr };
}

// Runs a scenario against a dist/ it created itself and always removes it afterward.
async function withDist(files, scenario) {
  fs.mkdirSync(distDir, { recursive: true });
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(distDir, name), content);
    }
    return await scenario();
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
}

describe("missing dist/ warning", { skip }, () => {
  test("warns at startup when dist/ is missing", async () => {
    const { stdout, stderr } = await runServer({}, 34568);
    assert.match(stderr, /dist\/ not found/);
    // The warning is advisory: the server must still come up so GET / keeps working.
    assert.match(stdout, /Server Established/);
  });

  test("warns from the first PM2 worker (instance 0)", async () => {
    const { stderr } = await runServer({ NODE_APP_INSTANCE: "0" }, 34569);
    assert.match(stderr, /dist\/ not found/);
  });

  test("stays quiet in other PM2 workers so the warning prints once per cluster", async () => {
    const { stdout, stderr } = await runServer({ NODE_APP_INSTANCE: "3" }, 34570);
    assert.doesNotMatch(stderr, /dist\/ not found/);
    assert.match(stdout, /Server Established/);
  });
});

describe("opt-in dist verification at startup", { skip }, () => {
  test("does nothing extra by default", async () => {
    await withDist({ "app.js": "console.log(1);" }, async () => {
      const { stderr } = await runServer({}, 34571);
      assert.doesNotMatch(stderr, /index\.html/);
    });
  });

  test("warns about each problem when VERIFY_DIST_ON_START=true, and still starts", async () => {
    await withDist({ "app.js": "console.log(1);" }, async () => {
      const { stdout, stderr } = await runServer({ VERIFY_DIST_ON_START: "true" }, 34572);
      assert.match(stderr, /dist verification found problems/);
      assert.match(stderr, /missing required file: index\.html/);
      assert.match(stdout, /Server Established/);
    });
  });

  test("is silent for a healthy dist/ when VERIFY_DIST_ON_START=true", async () => {
    await withDist({ "index.html": page }, async () => {
      const { stderr } = await runServer({ VERIFY_DIST_ON_START: "true" }, 34573);
      assert.doesNotMatch(stderr, /dist verification|missing required/);
    });
  });

  test("still starts and logs a warning when verification itself cannot run", async () => {
    const files = { "index.html": page, "index.html.br": zlib.brotliCompressSync(page) };
    await withDist(files, async () => {
      // A source file the server cannot read makes the deep check throw, as a permissions
      // problem or a file replaced mid-deploy would. express-static-gzip only lists file
      // names at startup, so the server itself can still run; the advisory check must not
      // be what takes it down.
      const source = path.join(distDir, "index.html");
      fs.chmodSync(source, 0o000);
      try {
        const { stdout, stderr } = await runServer({ VERIFY_DIST_ON_START: "true" }, 34575);
        assert.match(stderr, /dist verification could not run/);
        assert.match(stdout, /Server Established/);
      } finally {
        fs.chmodSync(source, 0o644);
      }
    });
  });

  test("reports only from the first PM2 worker", async () => {
    await withDist({ "app.js": "console.log(1);" }, async () => {
      const env = { VERIFY_DIST_ON_START: "true", NODE_APP_INSTANCE: "2" };
      const { stderr } = await runServer(env, 34574);
      assert.doesNotMatch(stderr, /dist verification/);
    });
  });
});
