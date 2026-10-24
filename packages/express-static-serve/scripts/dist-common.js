const fs = require("fs");
const path = require("path");

const DEFAULT_DIST_DIR = path.join(__dirname, "..", "dist");

// Symlinks are skipped so a link inside dist/ can never pull in a file from outside it.
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(entryPath);
    }
    return entry.isFile() ? [entryPath] : [];
  });
}

// The directory a command line script works on: its first argument, else the package's dist/.
function resolveDistDir(arg) {
  return path.resolve(arg || DEFAULT_DIST_DIR);
}

// Prints the outcome of verifyDist and tells the caller whether it passed, so the scripts that
// share it keep their own exit codes.
function reportVerification(dir, { ok, problems }) {
  if (ok) {
    console.log(`dist OK: ${dir}`);
    return true;
  }
  console.error(`dist verification failed for ${dir}:`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  return false;
}

module.exports = { listFiles, resolveDistDir, reportVerification };
