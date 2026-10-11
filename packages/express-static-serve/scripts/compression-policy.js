const path = require("path");

// Tunable policy for scripts/precompress.js. Everything that decides what gets compressed,
// and how hard, lives here so it can be adjusted without touching the compression mechanics.

// Below this size the variant saves too little to justify the extra file.
const MIN_SIZE_BYTES = 1024;

// Formats that compress well. Images, video, fonts (woff2), and archives are already
// compressed, so recompressing them wastes CPU and often produces a larger file.
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".map",
  ".svg",
  ".txt",
  ".xml",
  ".webmanifest",
  ".wasm",
  ".ico",
  ".csv",
]);

// Per-encoding effort, keyed by the file extension express-static-gzip matches on.
// Pre-compression happens once at build time, so the slowest, smallest settings are fine.
const LEVELS = {
  br: 11,
  gz: 9,
  zz: 9,
  zst: 19,
};

function shouldCompress(filePath, sizeBytes) {
  const extension = path.extname(filePath).toLowerCase();
  return sizeBytes >= MIN_SIZE_BYTES && COMPRESSIBLE_EXTENSIONS.has(extension);
}

module.exports = { shouldCompress, LEVELS };
