const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const serverPath = path.join(__dirname, "..", "server.js");
const STARTUP_TIMEOUT_MS = 5000;

// Resolves once the server's stdout matches `pattern`. Rejects, with whatever the server wrote,
// if it exits first or the deadline passes.
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

// Starts the real server and resolves once it is listening. `env` is layered over the caller's
// environment, `nodeArgs` are extra node flags, and `stop()` ends it and resolves with the
// final { code, signal } after all output has been collected.
async function startServer({ port, env = {}, nodeArgs = [] }) {
  const child = spawn(process.execPath, [...nodeArgs, serverPath], {
    env: { ...process.env, ...env, PORT: String(port) },
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
    await waitForOutput(server, /Server Established/, "the startup line");
  } catch (error) {
    await server.stop();
    throw error;
  }
  return server;
}

// One GET against a local server, resolving with the status and the whole body.
const httpGet = (port, urlPath, headers) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });

module.exports = { startServer, waitForOutput, httpGet };
