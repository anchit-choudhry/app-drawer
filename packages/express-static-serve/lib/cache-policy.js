const path = require("path");

// The extensions scripts/precompress.js appends. The static layer reports the path of the
// variant it serves, so the extension is removed before the name is judged.
const VARIANT_EXTENSION = /\.(zst|br|gz|zz)$/;
// A build hash: 8 or more lower-case hex characters after "." or "-", then one or two
// extensions. It must hold a digit and a letter, so that a date or a word does not match.
const HASHED_NAME = /[.-]([0-9a-f]{8,})(?:\.[a-z0-9]+){1,2}$/;
const HTML_NAME = /\.html?$/i;

const CACHE_CONTROL = {
  // The name changes whenever the content does, so the file never needs to be fetched again.
  immutable: "public, max-age=31536000, immutable",
  // Pages are revalidated on every use, so a new build shows up at once.
  html: "no-cache",
  // Everything else: 2 hours in browsers, 4 hours in shared caches.
  standard: "public, max-age=7200, must-revalidate, s-maxage=14400, proxy-revalidate",
};

function hasContentHash(name) {
  const match = HASHED_NAME.exec(name);
  return match !== null && /[0-9]/.test(match[1]) && /[a-f]/.test(match[1]);
}

function cachePolicyFor(filePath) {
  const name = path.basename(filePath).replace(VARIANT_EXTENSION, "");
  if (HTML_NAME.test(name)) {
    return "html";
  }
  return hasContentHash(name) ? "immutable" : "standard";
}

const cacheControlFor = (filePath) => CACHE_CONTROL[cachePolicyFor(filePath)];

module.exports = { cachePolicyFor, cacheControlFor, CACHE_CONTROL };
