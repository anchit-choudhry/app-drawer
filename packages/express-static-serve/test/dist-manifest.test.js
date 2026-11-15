const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  sha256,
  toKey,
  policyFingerprint,
  readManifest,
  writeManifest,
  buildId,
} = require("../scripts/dist-manifest");

let workDir;

// Scratch dirs live inside the package (never the system temp dir) and are removed after.
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-manifest-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const manifestPath = (dir = workDir) => path.join(dir, ".dist-manifest.json");
const entry = (hash, variants = []) => ({ sha256: hash, size: 1, variants });
const otherDir = () => fs.mkdtempSync(path.join(__dirname, ".tmp-manifest-"));

describe("sha256 and toKey", () => {
  test("sha256 is the hex digest", () => {
    assert.equal(
      sha256("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  test("toKey is the path inside dist/ with forward slashes", () => {
    assert.equal(toKey("/x/dist", path.join("/x/dist", "sub", "a.js")), "sub/a.js");
  });
});

describe("writeManifest and readManifest", () => {
  test("round-trip, with the keys sorted and the policy fingerprint recorded", () => {
    writeManifest(workDir, { "z.js": entry("1"), "a.js": entry("2", ["br"]) });
    const read = readManifest(workDir);
    assert.deepEqual(Object.keys(read.files), ["a.js", "z.js"]);
    assert.equal(read.version, 1);
    assert.equal(read.policy, policyFingerprint());
    assert.deepEqual(read.files["a.js"].variants, ["br"]);
  });

  test("the file ends with a newline and holds no time stamp", () => {
    writeManifest(workDir, { "a.js": entry("1") });
    const text = fs.readFileSync(manifestPath(), "utf8");
    assert.ok(text.endsWith("\n"));
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/);
  });

  test("returns null when dist/ has no manifest", () => {
    assert.equal(readManifest(workDir), null);
  });

  const invalid = {
    "invalid JSON": "{nope",
    "version 2": '{"version":2,"files":{}}',
    "files null": '{"version":1,"files":null}',
    "files as an array": '{"version":1,"files":[]}',
    "an entry without a variants array": '{"version":1,"files":{"a":{"sha256":"x"}}}',
    "a null entry": '{"version":1,"files":{"a":null}}',
    "a top-level array": "[]",
    "a top-level null": "null",
  };
  for (const [label, body] of Object.entries(invalid)) {
    test(`throws for ${label}`, () => {
      fs.writeFileSync(manifestPath(), body);
      assert.throws(() => readManifest(workDir), /dist-manifest\.json: is not/);
    });
  }

  test("a file named __proto__ survives a write and a read", () => {
    const files = Object.create(null);
    files.__proto__ = entry("1");
    writeManifest(workDir, files);
    assert.deepEqual(Object.keys(readManifest(workDir).files), ["__proto__"]);
  });
});

describe("policyFingerprint", () => {
  test("is a sha256 hex string and stable between calls", () => {
    assert.match(policyFingerprint(), /^[0-9a-f]{64}$/);
    assert.equal(policyFingerprint(), policyFingerprint());
  });
});

describe("buildId", () => {
  test("is null without a manifest and 12 hex characters with one", () => {
    assert.equal(buildId(workDir), null);
    writeManifest(workDir, { "a.js": entry("1") });
    assert.match(buildId(workDir), /^[0-9a-f]{12}$/);
  });

  test("is equal for two directories with the same content and differs after one byte", () => {
    const second = otherDir();
    try {
      writeManifest(workDir, { "a.js": entry("1") });
      writeManifest(second, { "a.js": entry("1") });
      assert.equal(buildId(workDir), buildId(second));
      writeManifest(second, { "a.js": entry("2") });
      assert.notEqual(buildId(workDir), buildId(second));
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});
