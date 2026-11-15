const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { precompress, formatSummary } = require("../scripts/precompress");
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

  test("compresses uncompressed font formats but not woff2 or a CommonJS file", () => {
    for (const name of ["font.ttf", "font.otf", "font.eot"]) {
      assert.equal(shouldCompress(name, 2048), true, name);
    }
    assert.equal(shouldCompress("font.woff2", 2048), false);
    // Browsers do not run .cjs, so it is not a web asset worth a variant.
    assert.equal(shouldCompress("app.cjs", 2048), false);
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

  test("does not write through a symlink that is named like a variant", () => {
    const outside = write("outside/victim.txt", "must stay exactly as it is");
    const served = path.join(workDir, "served");
    fs.mkdirSync(served);
    fs.writeFileSync(path.join(served, "app.js"), compressible);
    fs.symlinkSync(outside, path.join(served, "app.js.br"));
    precompress(served);
    assert.equal(fs.readFileSync(outside, "utf8"), "must stay exactly as it is");
    assert.equal(fs.lstatSync(path.join(served, "app.js.br")).isSymbolicLink(), false);
    assert.equal(
      zlib.brotliDecompressSync(fs.readFileSync(path.join(served, "app.js.br"))).toString(),
      compressible
    );
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

describe("precompress and the manifest", () => {
  const manifestFile = () => path.join(workDir, ".dist-manifest.json");
  const readManifestFile = () => JSON.parse(fs.readFileSync(manifestFile(), "utf8"));
  // Sets a file's modification time far in the past, so that a rewrite is visible.
  const OLD = new Date("2001-01-01T00:00:00Z");
  const age = (file) => fs.utimesSync(file, OLD, OLD);
  const mtime = (file) => fs.statSync(file).mtimeMs;

  test("a first run writes a manifest that lists each source with its variants", () => {
    write("app.js", compressible);
    write("logo.png", compressible);
    precompress(workDir);
    const { files, version } = readManifestFile();
    assert.equal(version, 1);
    assert.deepEqual(Object.keys(files), ["app.js", "logo.png"]);
    assert.deepEqual(files["app.js"].variants, ["br", "gz", "zz", "zst"]);
    assert.equal(files["app.js"].size, Buffer.byteLength(compressible));
    assert.deepEqual(files["logo.png"].variants, []);
  });

  test("a second run reports every file as unchanged and leaves the variants alone", () => {
    const file = write("app.js", compressible);
    write("logo.png", compressible);
    precompress(workDir);
    for (const ext of extensions) {
      age(`${file}.${ext}`);
    }
    const second = precompress(workDir);
    assert.deepEqual(
      { compressed: second.compressed, skipped: second.skipped, unchanged: second.unchanged },
      { compressed: 0, skipped: 0, unchanged: 2 }
    );
    for (const ext of extensions) {
      assert.equal(mtime(`${file}.${ext}`), OLD.getTime(), `${ext} variant was rewritten`);
    }
  });

  test("changing one source recompresses only that one", () => {
    const changed = write("a.js", compressible);
    const kept = write("b.js", compressible);
    precompress(workDir);
    age(`${kept}.br`);
    age(`${changed}.br`);
    fs.writeFileSync(changed, "const other = 1;\n".repeat(200));
    const summary = precompress(workDir);
    assert.equal(summary.compressed, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(mtime(`${kept}.br`), OLD.getTime());
    assert.notEqual(mtime(`${changed}.br`), OLD.getTime());
    const decoded = zlib.brotliDecompressSync(fs.readFileSync(`${changed}.br`));
    assert.equal(decoded.toString(), "const other = 1;\n".repeat(200));
  });

  test("a deleted variant is written again", () => {
    const file = write("app.js", compressible);
    precompress(workDir);
    fs.rmSync(`${file}.gz`);
    const summary = precompress(workDir);
    assert.equal(summary.compressed, 1);
    assert.equal(fs.existsSync(`${file}.gz`), true);
  });

  test("a stray variant next to an unchanged source is removed", () => {
    const file = write("noise.js", crypto.randomBytes(4096));
    precompress(workDir);
    fs.writeFileSync(`${file}.br`, "a variant nobody asked for");
    precompress(workDir);
    assert.equal(fs.existsSync(`${file}.br`), false);
  });

  test("a manifest written under another compression policy forces a full run", () => {
    write("app.js", compressible);
    precompress(workDir);
    const manifest = readManifestFile();
    fs.writeFileSync(manifestFile(), JSON.stringify({ ...manifest, policy: "another policy" }));
    const summary = precompress(workDir);
    assert.equal(summary.unchanged, 0);
    assert.equal(summary.compressed, 1);
    assert.notEqual(readManifestFile().policy, "another policy");
  });

  test("an unreadable or invalid manifest is replaced, not trusted", () => {
    write("app.js", compressible);
    fs.writeFileSync(manifestFile(), "{not json");
    const summary = precompress(workDir);
    assert.equal(summary.compressed, 1);
    assert.equal(readManifestFile().version, 1);
  });

  test("dot entries get no variants and no manifest entry", () => {
    write(".hidden.js", compressible);
    write("sub/.also-hidden.js", compressible);
    write("app.js", compressible);
    precompress(workDir);
    assert.equal(fs.existsSync(path.join(workDir, ".hidden.js.br")), false);
    assert.equal(fs.existsSync(path.join(workDir, "sub", ".also-hidden.js.br")), false);
    assert.deepEqual(Object.keys(readManifestFile().files), ["app.js"]);
  });

  test("a .well-known file is recorded and never compressed", () => {
    write(".well-known/security.txt", compressible);
    precompress(workDir);
    assert.equal(fs.existsSync(path.join(workDir, ".well-known", "security.txt.br")), false);
    const entry = readManifestFile().files[".well-known/security.txt"];
    assert.deepEqual(entry.variants, []);
    assert.equal(entry.size, Buffer.byteLength(compressible));
  });

  test("the manifest records a file named __proto__ like any other", () => {
    write("__proto__", "x");
    precompress(workDir);
    assert.deepEqual(Object.keys(readManifestFile().files), ["__proto__"]);
  });

  test("two runs on the same content write the same manifest bytes", () => {
    write("app.js", compressible);
    precompress(workDir);
    const first = fs.readFileSync(manifestFile(), "utf8");
    precompress(workDir);
    assert.equal(fs.readFileSync(manifestFile(), "utf8"), first);
  });
});

describe("formatSummary", () => {
  test("describes the counts and byte totals for a directory", () => {
    const summary = { compressed: 2, skipped: 1, unchanged: 3, bytesBefore: 100, bytesAfter: 10 };
    assert.equal(
      formatSummary(summary, "/site/dist"),
      "Precompressed 2 file(s), skipped 1, unchanged 3: 100 -> 10 bytes " +
        "(best variant per file) in /site/dist"
    );
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
