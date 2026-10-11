const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { verifyDist } = require("../scripts/verify-dist");

const verifyScript = path.join(__dirname, "..", "scripts", "verify-dist.js");
const html = "<!doctype html><title>app</title>\n".repeat(60);

let workDir;

// Scratch dirs live inside the package (never the system temp dir) and are removed after.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const write = (relative, content) => {
  const target = path.join(workDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
};

describe("verifyDist", () => {
  test("accepts a dist with an index.html and no variants", () => {
    write("index.html", html);
    assert.deepEqual(verifyDist(workDir), { ok: true, problems: [] });
  });

  test("accepts variants that decompress to their source", () => {
    write("index.html", html);
    write("index.html.br", zlib.brotliCompressSync(html));
    write("index.html.gz", zlib.gzipSync(html));
    write("index.html.zz", zlib.deflateSync(html));
    write("index.html.zst", zlib.zstdCompressSync(html));
    assert.equal(verifyDist(workDir).ok, true);
  });

  test("reports a missing directory", () => {
    const result = verifyDist(path.join(workDir, "nope"));
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /not a directory/i);
  });

  test("reports a missing index.html", () => {
    write("app.js", "console.log(1);");
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /index\.html/);
  });

  test("reports an orphaned variant whose source file is gone", () => {
    write("index.html", html);
    write("gone.js.br", zlib.brotliCompressSync("old"));
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /gone\.js\.br.*no source/i);
  });

  test("reports a stale variant that no longer matches its source", () => {
    write("index.html", html);
    write("index.html.br", zlib.brotliCompressSync("an older build of the page"));
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /index\.html\.br.*does not match/i);
  });

  test("reports a corrupt variant", () => {
    write("index.html", html);
    write("index.html.gz", "this is not gzip data");
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /index\.html\.gz.*cannot be decompressed/i);
  });
});

describe("verify-dist command line", () => {
  test("exits 0 for a healthy dist", () => {
    write("index.html", html);
    const result = spawnSync(process.execPath, [verifyScript, workDir], { encoding: "utf8" });
    assert.equal(result.status, 0);
  });

  test("exits 1 and names the problem for a broken dist", () => {
    write("app.js", "console.log(1);");
    const result = spawnSync(process.execPath, [verifyScript, workDir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /index\.html/);
  });
});
