const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Keyed by the file extension express-static-gzip matches on (see server.js).
const decoders = {
  br: zlib.brotliDecompressSync,
  gz: zlib.gunzipSync,
  zz: zlib.inflateSync,
  zst: zlib.zstdDecompressSync,
};
const REQUIRED_FILES = ["index.html"];

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(entryPath);
    }
    return entry.isFile() ? [entryPath] : [];
  });
}

// Checks that dist/ is something the server can safely serve. The server itself starts and
// reports UP with an empty or stale dist/, so this is the only place a bad build is caught.
function verifyDist(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, problems: [`${dir} is not a directory`] };
  }

  const problems = [];

  for (const required of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, required))) {
      problems.push(`missing required file: ${required}`);
    }
  }

  for (const file of listFiles(dir)) {
    const extension = path.extname(file).slice(1);
    if (!decoders[extension]) {
      continue;
    }

    const label = path.relative(dir, file);
    const source = file.slice(0, -(extension.length + 1));
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      problems.push(`${label}: variant has no source file`);
      continue;
    }

    let decoded;
    try {
      decoded = decoders[extension](fs.readFileSync(file));
    } catch {
      problems.push(`${label}: cannot be decompressed`);
      continue;
    }
    if (!decoded.equals(fs.readFileSync(source))) {
      problems.push(`${label}: does not match its source file (stale variant)`);
    }
  }

  return { ok: problems.length === 0, problems };
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));
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
}

module.exports = { verifyDist };
