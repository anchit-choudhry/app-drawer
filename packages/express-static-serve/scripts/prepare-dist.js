const { resolveDistDir, reportVerification } = require("./dist-common");
const { precompress, formatSummary } = require("./precompress");
const { verifyDist } = require("./verify-dist");

// One step for the whole post-build routine: compress, then verify what was written.
// Verification runs after compression on purpose, so it also checks the fresh variants.
const dir = resolveDistDir(process.argv[2]);

try {
  console.log(formatSummary(precompress(dir), dir));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!reportVerification(dir, verifyDist(dir))) {
  process.exit(1);
}
