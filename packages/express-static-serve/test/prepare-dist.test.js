const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const script = path.join(__dirname, "..", "scripts", "prepare-dist.js");
const page = "<!doctype html><title>app</title>\n".repeat(60);

let workDir;

// Scratch dirs live inside the package (never the system temp dir) and are removed after.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-prepare-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const write = (relative, content) => fs.writeFileSync(path.join(workDir, relative), content);
const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

describe("prepare-dist command line", () => {
  test("precompresses and then verifies a healthy dist", () => {
    write("index.html", page);
    const result = run(workDir);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(path.join(workDir, "index.html.br")), true);
    assert.match(result.stdout, /Precompressed 1 file\(s\)/);
    assert.match(result.stdout, /dist OK/);
    assert.match(result.stdout, /dist CSP OK/);
    assert.equal(fs.existsSync(path.join(workDir, ".dist-manifest.json")), true);
  });

  test("exits 1 when verification fails after compression", () => {
    write("app.js", "console.log(1);\n".repeat(200));
    const result = run(workDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /index\.html/);
  });

  test("exits 1 for a page the CSP blocks, and still writes the variants and the manifest", () => {
    write("index.html", page + "<script>alert(1)</script>\n");
    const result = run(workDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dist CSP verification failed/);
    assert.match(result.stderr, /index\.html:61: inline <script>/);
    assert.match(result.stdout, /dist OK/);
    assert.equal(fs.existsSync(path.join(workDir, "index.html.br")), true);
    assert.equal(fs.existsSync(path.join(workDir, ".dist-manifest.json")), true);
  });

  test("runs both checks even when the first one fails, so one run shows everything", () => {
    write("other.html", page + "<script>alert(1)</script>\n");
    const result = run(workDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dist verification failed/);
    assert.match(result.stderr, /missing required file: index\.html/);
    assert.match(result.stderr, /dist CSP verification failed/);
    assert.match(result.stderr, /other\.html:61: inline <script>/);
  });

  test("exits 1 without verifying when the directory does not exist", () => {
    const result = run(path.join(workDir, "missing"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a directory/i);
    assert.doesNotMatch(result.stdout, /dist OK/);
  });
});
