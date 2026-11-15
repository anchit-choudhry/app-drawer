const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { ENV_NAMES } = require("../lib/config");

const serverPath = path.join(__dirname, "..", "server.js");
// Generous on purpose: the tests run in parallel, and a 2 vCPU CI runner can be slow to boot
// several node processes at once.
const STARTUP_TIMEOUT_MS = 10000;
const PORT_LINE = /Server Established at PORT -> (\d+)/;
// Every variable that changes how the server or the PM2 ecosystem file behaves.
const SERVER_ENV_NAMES = [...ENV_NAMES, "NODE_ENV", "NODE_APP_INSTANCE"];
// `node -e <LAUNCH> <distDir>` runs the real start() against a chosen directory, so a test
// never touches the package's own dist/.
const LAUNCH = `require(${JSON.stringify(serverPath)}).start({ distDir: process.argv[1] })`;
// A path that is never created, for tests that need dist/ to be missing.
const MISSING_DIST = path.join(__dirname, ".tmp-no-dist");

// A value exported in the developer's shell must not change what a test loads or starts.
function clearConfigEnv() {
  for (const name of SERVER_ENV_NAMES) {
    delete process.env[name];
  }
}

function cleanEnv() {
  const env = { ...process.env };
  for (const name of SERVER_ENV_NAMES) {
    delete env[name];
  }
  return env;
}

// Creates a scratch dist/ inside the package (never the system temp dir). `files` maps a
// relative path to its content. Remove it with removeDir when the test is done.
function makeDist(files = {}) {
  const dir = fs.mkdtempSync(path.join(__dirname, ".tmp-dist-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

const removeDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// Resolves once the server's stdout matches `pattern`. Rejects, with whatever the server
// wrote, if it exits first or the deadline passes.
function waitForOutput(server, pattern, what, timeoutMs = STARTUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const fail = (message) => {
        clearInterval(poll);
        reject(new Error(`${message}:\n${server.stdout}${server.stderr}`));
      };
      if (pattern.test(server.stdout)) {
        clearInterval(poll);
        resolve();
      } else if (server.exit) {
        fail(`server exited early (${server.exit.code}) before ${what}`);
      } else if (Date.now() > deadline) {
        fail(`${what} did not appear`);
      }
    }, 25);
  });
}

// Starts the real server on a free port and resolves once it is listening. `distDir` is the
// directory to serve (missing by default), `env` is layered over a cleaned environment,
// `nodeArgs` are extra node flags, and `main: true` runs server.js itself, which serves the
// package's own dist/. `server.port` is the port it got; `stop()` ends it and resolves with
// the final { code, signal } after all output has been collected.
async function startServer({ distDir = MISSING_DIST, env = {}, nodeArgs = [], main = false }) {
  const script = main ? [serverPath] : ["-e", LAUNCH, distDir];
  const child = spawn(process.execPath, [...nodeArgs, ...script], {
    env: { ...cleanEnv(), PORT: "0", ...env },
  });
  const server = { child, stdout: "", stderr: "", exit: null };
  child.stdout.on("data", (chunk) => (server.stdout += chunk));
  child.stderr.on("data", (chunk) => (server.stderr += chunk));
  server.closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      server.exit = { code, signal };
      resolve(server.exit);
    });
  });
  server.stop = () => {
    if (!server.exit) {
      child.kill("SIGTERM");
    }
    return server.closed;
  };

  try {
    await waitForOutput(server, PORT_LINE, "the startup line");
  } catch (error) {
    await server.stop();
    throw error;
  }
  server.port = Number(PORT_LINE.exec(server.stdout)[1]);
  return server;
}

// One request against a local server, with the path sent exactly as given. Resolves with the
// status, the headers, and the whole body.
function httpRequest(port, urlPath, { method = "GET", headers } = {}) {
  return new Promise((resolve, reject) => {
    const options = { host: "127.0.0.1", port, path: urlPath, method, headers, agent: false };
    http
      .request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject)
      .end();
  });
}

const httpGet = (port, urlPath, headers) => httpRequest(port, urlPath, { headers });

// Listens on a free local port and resolves with the http.Server.
function listenLocal(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

module.exports = {
  serverPath,
  clearConfigEnv,
  cleanEnv,
  makeDist,
  removeDir,
  startServer,
  waitForOutput,
  httpRequest,
  httpGet,
  listenLocal,
};
