const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { precompress } = require("../scripts/precompress");
const { shouldCompress } = require("../scripts/compression-policy");

const decoders = {
  br: zlib.brotliDecompressSync,
  gz: zlib.gunzipSync,
  zz: zlib.inflateSync,
  zst: zlib.zstdDecompressSync,
};
const extensions = Object.keys(decoders);

// Large and repetitive enough to clear the size threshold and compress well.
const compressible = "const answer = 42;\n".repeat(200);

let workDir;

// Scratch dirs live inside the package (never the system temp dir) and are removed after.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-precompress-"));
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

describe("compression policy", () => {
  test("compresses large text-like assets", () => {
    assert.equal(shouldCompress("app.js", 5000), true);
    assert.equal(shouldCompress("index.html", 5000), true);
    assert.equal(shouldCompress("style.css", 5000), true);
  });

  test("skips formats that are already compressed", () => {
    assert.equal(shouldCompress("photo.png", 500000), false);
    assert.equal(shouldCompress("clip.mp4", 500000), false);
    assert.equal(shouldCompress("app.js.br", 5000), false);
  });

  test("skips files too small to be worth compressing", () => {
    assert.equal(shouldCompress("tiny.js", 100), false);
  });
});

describe("precompress", () => {
  test("writes all four variants and each one decompresses to the original", () => {
    const file = write("app.js", compressible);
    precompress(workDir);
    for (const ext of extensions) {
      const variant = fs.readFileSync(`${file}.${ext}`);
      assert.equal(decoders[ext](variant).toString(), compressible, `${ext} variant`);
    }
  });

  test("leaves the original file untouched", () => {
    const file = write("app.js", compressible);
    precompress(workDir);
    assert.equal(fs.readFileSync(file, "utf8"), compressible);
  });

  test("skips non-compressible formats and files below the size threshold", () => {
    const image = write("logo.png", compressible);
    const tiny = write("tiny.js", "x = 1;");
    precompress(workDir);
    for (const ext of extensions) {
      assert.equal(fs.existsSync(`${image}.${ext}`), false);
      assert.equal(fs.existsSync(`${tiny}.${ext}`), false);
    }
  });

  test("does not keep a variant that is not smaller than the original", () => {
    const file = write("noise.js", crypto.randomBytes(4096));
    precompress(workDir);
    for (const ext of extensions) {
      assert.equal(fs.existsSync(`${file}.${ext}`), false, `${ext} variant should be dropped`);
    }
  });

  test("removes a stale variant when the file no longer compresses", () => {
    const file = write("noise.js", crypto.randomBytes(4096));
    fs.writeFileSync(`${file}.br`, "stale content from an earlier build");
    precompress(workDir);
    assert.equal(fs.existsSync(`${file}.br`), false);
  });

  test("is idempotent and never compresses its own output", () => {
    write("app.js", compressible);
    precompress(workDir);
    const first = fs.readdirSync(workDir).sort();
    precompress(workDir);
    assert.deepEqual(fs.readdirSync(workDir).sort(), first);
  });

  test("recurses into subdirectories", () => {
    const nested = write("assets/js/app.js", compressible);
    precompress(workDir);
    assert.equal(fs.existsSync(`${nested}.br`), true);
  });

  test("does not follow symlinks out of the directory", () => {
    const outside = write("outside/secret.js", compressible);
    const served = path.join(workDir, "served");
    fs.mkdirSync(served);
    fs.symlinkSync(outside, path.join(served, "link.js"));
    precompress(served);
    assert.equal(fs.existsSync(`${outside}.br`), false);
    assert.equal(fs.existsSync(path.join(served, "link.js.br")), false);
  });

  test("reports what it did", () => {
    write("app.js", compressible);
    write("logo.png", compressible);
    const summary = precompress(workDir);
    assert.equal(summary.compressed, 1);
    assert.equal(summary.skipped, 1);
    assert.ok(summary.bytesAfter < summary.bytesBefore);
  });

  test("fails clearly when the directory does not exist", () => {
    assert.throws(() => precompress(path.join(workDir, "missing")), /not a directory/i);
  });
});

describe("precompress command line", () => {
  const script = path.join(__dirname, "..", "scripts", "precompress.js");
  const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

  test("compresses the given directory and reports a summary", () => {
    const file = write("app.js", compressible);
    const result = run(workDir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Precompressed 1 file\(s\)/);
    assert.equal(fs.existsSync(`${file}.br`), true);
  });

  test("exits 1 with a clear message when the directory does not exist", () => {
    const result = run(path.join(workDir, "missing"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a directory/i);
  });
});
