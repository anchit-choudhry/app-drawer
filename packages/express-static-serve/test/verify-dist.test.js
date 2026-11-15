const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { verifyDist } = require("../scripts/verify-dist");
const { precompress } = require("../scripts/precompress");

const verifyScript = path.join(__dirname, "..", "scripts", "verify-dist.js");
const html = "<!doctype html><title>app</title>\n".repeat(60);

let workDir;
let outsideDir;

// Scratch dirs live inside the package (never the system temp dir) and are removed after.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-"));
  outsideDir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-outside-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

const write = (relative, content) => {
  const target = path.join(workDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
};

// Writes the sources, then runs precompress, so the directory is as prepare-dist leaves it.
const prepared = (files) => {
  for (const [name, content] of Object.entries(files)) {
    write(name, content);
  }
  precompress(workDir);
};
const problemsOf = () => verifyDist(workDir).problems.join("\n");

describe("verifyDist", () => {
  test("accepts a prepared dist with an index.html", () => {
    prepared({ "index.html": html });
    assert.deepEqual(verifyDist(workDir), { ok: true, problems: [] });
  });

  test("accepts variants that decompress to their source", () => {
    prepared({ "index.html": html });
    for (const extension of ["br", "gz", "zz", "zst"]) {
      assert.equal(fs.existsSync(path.join(workDir, `index.html.${extension}`)), true);
    }
    assert.equal(verifyDist(workDir).ok, true);
  });

  test("reports a missing directory", () => {
    const result = verifyDist(path.join(workDir, "nope"));
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /not a directory/i);
  });

  test("reports a missing index.html", () => {
    prepared({ "app.js": "console.log(1);" });
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /index\.html/);
  });

  test("reports an orphaned variant whose source file is gone", () => {
    prepared({ "index.html": html });
    write("gone.js.br", zlib.brotliCompressSync("old"));
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /gone\.js\.br.*no source/i);
  });

  test("reports a stale variant that no longer matches its source", () => {
    prepared({ "index.html": html });
    write("index.html.br", zlib.brotliCompressSync("an older build of the page"));
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /index\.html\.br.*does not match/i);
  });

  test("reports a corrupt variant", () => {
    prepared({ "index.html": html });
    write("index.html.gz", "this is not gzip data");
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /index\.html\.gz.*cannot be decompressed/i);
  });
});

describe("verifyDist and the manifest", () => {
  test("reports a dist that was never prepared", () => {
    write("index.html", html);
    const result = verifyDist(workDir);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /missing \.dist-manifest\.json: run prepare-dist/);
  });

  test("reports a manifest it cannot understand", () => {
    prepared({ "index.html": html });
    write(".dist-manifest.json", "{not json");
    assert.match(problemsOf(), /dist-manifest\.json: is not valid JSON/);
  });

  test("reports a file added after prepare-dist", () => {
    prepared({ "index.html": html });
    write("late.js", "console.log(1);");
    assert.match(problemsOf(), /late\.js: not in the manifest \(added after prepare-dist\)/);
  });

  test("reports a file changed after prepare-dist", () => {
    prepared({ "index.html": html, "app.js": "console.log(1);" });
    write("app.js", "console.log(2);");
    assert.match(problemsOf(), /app\.js: changed since prepare-dist/);
  });

  test("reports a file removed after prepare-dist", () => {
    prepared({ "index.html": html, "app.js": "console.log(1);" });
    fs.rmSync(path.join(workDir, "app.js"));
    assert.match(problemsOf(), /app\.js: listed in the manifest but missing/);
  });

  test("reports a variant removed after prepare-dist", () => {
    prepared({ "index.html": html });
    fs.rmSync(path.join(workDir, "index.html.br"));
    assert.match(problemsOf(), /index\.html\.br: variant listed in the manifest is missing/);
  });

  test("reports a variant the manifest does not list", () => {
    prepared({ "index.html": html, "tiny.js": "x = 1;" });
    write("tiny.js.br", zlib.brotliCompressSync("x = 1;"));
    assert.match(problemsOf(), /tiny\.js\.br: variant is not in the manifest/);
  });

  test("accepts a prepared dist with a .well-known file", () => {
    prepared({ "index.html": html, ".well-known/security.txt": "Contact: x\n" });
    assert.deepEqual(verifyDist(workDir), { ok: true, problems: [] });
  });

  test("reports a .well-known file changed after prepare-dist", () => {
    prepared({ "index.html": html, ".well-known/security.txt": "Contact: x\n" });
    write(".well-known/security.txt", "Contact: y\n");
    assert.match(problemsOf(), /\.well-known\/security\.txt: changed since prepare-dist/);
  });
});

describe("verifyDist and what the server would do with an entry", () => {
  test("reports a symbolic link, which the server would follow", () => {
    prepared({ "index.html": html });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(workDir, "link.txt"));
    assert.match(problemsOf(), /link\.txt: symbolic link \(the server would follow it/);
  });

  test("reports a stray dotfile, which is never served", () => {
    prepared({ "index.html": html });
    write(".env", "SECRET=1");
    write(".DS_Store", "x");
    const problems = problemsOf();
    assert.match(problems, /\.env: dot entry \(never served; remove it from dist\/\)/);
    assert.match(problems, /\.DS_Store: dot entry/);
  });

  test("does not report the manifest itself", () => {
    prepared({ "index.html": html });
    assert.equal(fs.existsSync(path.join(workDir, ".dist-manifest.json")), true);
    assert.equal(verifyDist(workDir).ok, true);
  });
});

describe("verify-dist command line", () => {
  test("exits 0 for a healthy dist", () => {
    prepared({ "index.html": html });
    const result = spawnSync(process.execPath, [verifyScript, workDir], { encoding: "utf8" });
    assert.equal(result.status, 0);
  });

  test("exits 1 and names the problem for a broken dist", () => {
    prepared({ "app.js": "console.log(1);" });
    const result = spawnSync(process.execPath, [verifyScript, workDir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /index\.html/);
  });
});
