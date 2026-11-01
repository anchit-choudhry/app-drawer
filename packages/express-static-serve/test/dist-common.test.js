const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { listFiles, resolveDistDir, reportVerification } = require("../scripts/dist-common");

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
