const fs = require("fs");
const path = require("path");

const DEFAULT_DIST_DIR = path.join(__dirname, "..", "dist");

const MANIFEST_NAME = ".dist-manifest.json";
const WELL_KNOWN_DIR = ".well-known";
// Keyed by the file extension express-static-gzip matches on (see server.js).
const VARIANT_EXTENSIONS = ["br", "gz", "zz", "zst"];

const isVariant = (file) => VARIANT_EXTENSIONS.some((extension) => file.endsWith(`.${extension}`));

// Sorts everything in dist/ into what the server does with it. Symlinks are not followed,
// because the server would follow them out of dist/. Dot entries are never served, except the
// top-level .well-known directory. The manifest is this tooling's own file.
function scanDist(dir) {
  const found = { files: [], wellKnownFiles: [], symlinks: [], dotEntries: [] };
  const walk = (current, bucket) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const atTop = current === dir;
      if (entry.isSymbolicLink()) {
        found.symlinks.push(entryPath);
      } else if (atTop && entry.name === MANIFEST_NAME && entry.isFile()) {
        continue;
      } else if (atTop && entry.name === WELL_KNOWN_DIR && entry.isDirectory()) {
        walk(entryPath, found.wellKnownFiles);
      } else if (entry.name.startsWith(".")) {
        found.dotEntries.push(entryPath);
      } else if (entry.isDirectory()) {
        walk(entryPath, bucket);
      } else if (entry.isFile()) {
        bucket.push(entryPath);
      }
    }
  };
  walk(dir, found.files);
  return found;
}

function listFiles(dir) {
  return scanDist(dir).files;
}

// The directory a command line script works on: its first argument, else the package's dist/.
function resolveDistDir(arg) {
  return path.resolve(arg || DEFAULT_DIST_DIR);
}

// Prints the outcome of a check and tells the caller whether it passed, so the scripts that
// share it keep their own exit codes. `name` says which check this was.
function reportVerification(dir, { ok, problems }, name = "dist") {
  if (ok) {
    console.log(`${name} OK: ${dir}`);
    return true;
  }
  console.error(`${name} verification failed for ${dir}:`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  return false;
}

module.exports = {
  MANIFEST_NAME,
  WELL_KNOWN_DIR,
  VARIANT_EXTENSIONS,
  isVariant,
  scanDist,
  listFiles,
  resolveDistDir,
  reportVerification,
};
