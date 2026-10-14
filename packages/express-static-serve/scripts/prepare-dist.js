const path = require("path");
const { precompress, formatSummary } = require("./precompress");
const { verifyDist } = require("./verify-dist");

// One step for the whole post-build routine: compress, then verify what was written.
// Verification runs after compression on purpose, so it also checks the fresh variants.
const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));

try {
  console.log(formatSummary(precompress(dir), dir));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { ok, problems } = verifyDist(dir);
if (ok) {
  console.log(`dist OK: ${dir}`);
} else {
  console.error(`dist verification failed for ${dir}:`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}
