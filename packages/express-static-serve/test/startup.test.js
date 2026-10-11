const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "dist");
const serverPath = path.join(__dirname, "..", "server.js");

// A pre-built production dist/ (per CLAUDE.md) must never be touched by tests, so
// this scenario only runs when dist/ is genuinely absent.
const distPresent = fs.existsSync(distDir);

test(
  "warns at startup when dist/ is missing",
  { skip: distPresent && "dist/ exists; cannot simulate a missing dist/ safely" },
  async () => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: "34568" },
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
    });

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;

    assert.match(stderr, /dist\/ not found/);
    // The warning is advisory: the server must still come up so GET / keeps working.
    assert.match(stdout, /Server Established/);
  }
);
