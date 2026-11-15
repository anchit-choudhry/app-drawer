const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  listFiles,
  scanDist,
  isVariant,
  VARIANT_EXTENSIONS,
  resolveDistDir,
  reportVerification,
} = require("../scripts/dist-common");

let workDir;
let outsideDir;

// Scratch dirs live inside the package (never the system temp dir) and are removed after.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-common-"));
  outsideDir = fs.mkdtempSync(path.join(__dirname, ".tmp-outside-"));
});

afterEach(() => {
  mock.restoreAll();
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

describe("listFiles", () => {
  test("lists regular files in nested subdirectories", () => {
    fs.mkdirSync(path.join(workDir, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(workDir, "top.txt"), "x");
    fs.writeFileSync(path.join(workDir, "a", "b", "deep.txt"), "x");
    const found = listFiles(workDir).map((file) => path.relative(workDir, file));
    assert.deepEqual(found.sort(), [path.join("a", "b", "deep.txt"), "top.txt"]);
  });

  test("skips symlinks, so a link can never pull in a file from outside the directory", () => {
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
    fs.writeFileSync(path.join(workDir, "real.txt"), "x");
    fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(workDir, "link-file"));
    fs.symlinkSync(outsideDir, path.join(workDir, "link-dir"));
    const found = listFiles(workDir).map((file) => path.relative(workDir, file));
    assert.deepEqual(found, ["real.txt"]);
  });
});

describe("scanDist", () => {
  const touch = (relative, content = "x") => {
    const target = path.join(workDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const relative = (files) => files.map((file) => path.relative(workDir, file)).sort();

  test("sorts regular files into files and top-level .well-known files into wellKnownFiles", () => {
    touch("index.html");
    touch("sub/app.js");
    touch(".well-known/security.txt");
    touch(".well-known/nested/apple-app-site-association");
    const found = scanDist(workDir);
    assert.deepEqual(relative(found.files), ["index.html", path.join("sub", "app.js")]);
    assert.deepEqual(relative(found.wellKnownFiles), [
      path.join(".well-known", "nested", "apple-app-site-association"),
      path.join(".well-known", "security.txt"),
    ]);
    assert.deepEqual(found.symlinks, []);
    assert.deepEqual(found.dotEntries, []);
  });

  test("reports a file link and a directory link as symlinks and does not follow them", () => {
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
    touch("real.txt");
    fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(workDir, "link-file"));
    fs.symlinkSync(outsideDir, path.join(workDir, "link-dir"));
    const found = scanDist(workDir);
    assert.deepEqual(relative(found.files), ["real.txt"]);
    assert.deepEqual(relative(found.symlinks), ["link-dir", "link-file"]);
  });

  test("reports dot entries and does not descend into them", () => {
    touch(".env");
    touch("sub/.hidden");
    touch(".git/config");
    touch(".well-known/.secret");
    touch(".well-known/security.txt");
    const found = scanDist(workDir);
    assert.deepEqual(relative(found.dotEntries), [
      ".env",
      ".git",
      path.join(".well-known", ".secret"),
      path.join("sub", ".hidden"),
    ]);
    assert.deepEqual(relative(found.wellKnownFiles), [path.join(".well-known", "security.txt")]);
    assert.deepEqual(found.files, []);
  });

  test("leaves the top-level manifest out of every list", () => {
    touch(".dist-manifest.json", "{}");
    const found = scanDist(workDir);
    assert.deepEqual(found, { files: [], wellKnownFiles: [], symlinks: [], dotEntries: [] });
  });

  test("treats a .well-known directory that is not at the top as a dot entry", () => {
    touch("sub/.well-known/security.txt");
    const found = scanDist(workDir);
    assert.deepEqual(relative(found.dotEntries), [path.join("sub", ".well-known")]);
    assert.deepEqual(found.wellKnownFiles, []);
  });

  test("treats a .well-known that is a file as a dot entry", () => {
    touch(".well-known");
    assert.deepEqual(relative(scanDist(workDir).dotEntries), [".well-known"]);
  });

  test("listFiles returns only the regular files", () => {
    touch("a.txt");
    touch(".well-known/security.txt");
    touch(".env");
    assert.deepEqual(relative(listFiles(workDir)), ["a.txt"]);
  });
});

describe("variant extensions", () => {
  test("are the four the server negotiates", () => {
    assert.deepEqual([...VARIANT_EXTENSIONS].sort(), ["br", "gz", "zst", "zz"]);
  });

  test("isVariant is true for each of them and false for anything else", () => {
    for (const extension of VARIANT_EXTENSIONS) {
      assert.equal(isVariant(`/d/app.js.${extension}`), true);
    }
    assert.equal(isVariant("/d/app.js"), false);
    assert.equal(isVariant("/d/app.js.map"), false);
    assert.equal(isVariant("/d/bz"), false);
  });
});

describe("resolveDistDir", () => {
  test("defaults to the package's dist directory", () => {
    const expected = path.join(__dirname, "..", "dist");
    assert.equal(resolveDistDir(undefined), path.resolve(expected));
  });

  test("resolves a given directory to an absolute path", () => {
    assert.equal(resolveDistDir("some/dir"), path.resolve("some/dir"));
  });
});

describe("reportVerification", () => {
  test("prints the OK line to stdout and returns true", () => {
    const log = mock.method(console, "log", () => {});
    const error = mock.method(console, "error", () => {});
    assert.equal(reportVerification("/d", { ok: true, problems: [] }), true);
    assert.deepEqual(
      log.mock.calls.map((call) => call.arguments),
      [["dist OK: /d"]]
    );
    assert.equal(error.mock.callCount(), 0);
  });

  test("uses the given name in both messages", () => {
    const log = mock.method(console, "log", () => {});
    const error = mock.method(console, "error", () => {});
    assert.equal(reportVerification("/d", { ok: true, problems: [] }, "dist CSP"), true);
    assert.equal(reportVerification("/d", { ok: false, problems: ["p"] }, "dist CSP"), false);
    assert.deepEqual(log.mock.calls[0].arguments, ["dist CSP OK: /d"]);
    assert.deepEqual(error.mock.calls[0].arguments, ["dist CSP verification failed for /d:"]);
  });

  test("prints the failure header and one line per problem to stderr and returns false", () => {
    const log = mock.method(console, "log", () => {});
    const error = mock.method(console, "error", () => {});
    const result = { ok: false, problems: ["first", "second"] };
    assert.equal(reportVerification("/d", result), false);
    assert.deepEqual(
      error.mock.calls.map((call) => call.arguments),
      [["dist verification failed for /d:"], ["  - first"], ["  - second"]]
    );
    assert.equal(log.mock.callCount(), 0);
  });
});
