const { resolveDistDir, reportVerification } = require("./dist-common");
const { checkCsp } = require("./check-csp");
const { precompress, formatSummary } = require("./precompress");
const { verifyDist } = require("./verify-dist");

// One step for the whole post-build routine: compress, then verify what was written, then check
// that the pages work under the Content-Security-Policy the server sends. The checks run after
// compression on purpose, so they also see the fresh variants and the manifest, and both run even
// when the first fails, so one run shows everything that is wrong.
const dir = resolveDistDir(process.argv[2]);

try {
  console.log(formatSummary(precompress(dir), dir));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const verified = reportVerification(dir, verifyDist(dir));
const cspClean = reportVerification(dir, checkCsp(dir), "dist CSP");
if (!verified || !cspClean) {
  process.exit(1);
}
