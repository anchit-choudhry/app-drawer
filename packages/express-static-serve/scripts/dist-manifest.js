const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { LEVELS, MIN_SIZE_BYTES, COMPRESSIBLE_EXTENSIONS } = require("./compression-policy");
const { MANIFEST_NAME } = require("./dist-common");

const MANIFEST_VERSION = 1;

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// The manifest key of a file: its path inside dist/, with forward slashes on every platform.
const toKey = (dir, file) => path.relative(dir, file).split(path.sep).join("/");

// Changes whenever the compression policy does, which makes precompress redo every file.
function policyFingerprint() {
  return sha256(JSON.stringify([LEVELS, MIN_SIZE_BYTES, [...COMPRESSIBLE_EXTENSIONS].sort()]));
}

// Returns the manifest, or null when dist/ has none. Throws when the file is not a manifest
// this version understands.
function readManifest(dir) {
  const file = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(file)) {
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${MANIFEST_NAME}: is not valid JSON`);
  }
  const files = manifest?.files;
  const valid =
    manifest?.version === MANIFEST_VERSION &&
    files !== null &&
    typeof files === "object" &&
    !Array.isArray(files) &&
    Object.values(files).every(
      (entry) => typeof entry?.sha256 === "string" && Array.isArray(entry?.variants)
    );
  if (!valid) {
    throw new Error(`${MANIFEST_NAME}: is not a version ${MANIFEST_VERSION} manifest`);
  }
  return manifest;
}

// `files` maps a key to { sha256, size, variants }.
function writeManifest(dir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const manifest = { version: MANIFEST_VERSION, policy: policyFingerprint(), files: sorted };
  fs.writeFileSync(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// A short name for one exact build: the start of the manifest's own hash. Null without one.
function buildId(dir) {
  const file = path.join(dir, MANIFEST_NAME);
  return fs.existsSync(file) ? sha256(fs.readFileSync(file)).slice(0, 12) : null;
}

module.exports = { sha256, toKey, policyFingerprint, readManifest, writeManifest, buildId };
