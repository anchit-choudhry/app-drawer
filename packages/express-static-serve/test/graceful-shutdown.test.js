const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "dist");
const serverPath = path.join(__dirname, "..", "server.js");

test("SIGTERM shuts the server down gracefully", async () => {
  // Only remove dist/ afterward if this test is the one that created it - a
  // pre-built production dist/ (per CLAUDE.md) must never be deleted by tests.
  const distDirPreexisted = fs.existsSync(distDir);
  fs.mkdirSync(distDir, { recursive: true });

  try {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: "34567" },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not start in time")), 5000);
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("Server Established")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", reject);
    });

    const exited = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    child.kill("SIGTERM");

    const result = await Promise.race([
      exited,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("server did not exit within timeout")), 5000)
      ),
    ]);

    assert.equal(result.code, 0);
  } finally {
    if (!distDirPreexisted) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  }
});
