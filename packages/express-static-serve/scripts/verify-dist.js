const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const {
  MANIFEST_NAME,
  VARIANT_EXTENSIONS,
  isVariant,
  scanDist,
  resolveDistDir,
  reportVerification,
} = require("./dist-common");
const { sha256, toKey, readManifest } = require("./dist-manifest");

// Keyed by the file extension express-static-gzip matches on (see server.js).
const decoders = {
  br: zlib.brotliDecompressSync,
  gz: zlib.gunzipSync,
  zz: zlib.inflateSync,
  zst: zlib.zstdDecompressSync,
};
const REQUIRED_FILES = ["index.html"];

// Compares dist/ with what precompress recorded, so a file that was added, changed, or lost
// after the last prepare-dist is reported.
function manifestProblems(dir, sources) {
  let manifest;
  try {
    manifest = readManifest(dir);
  } catch (error) {
    return [error.message];
  }
  if (!manifest) {
    return [`missing ${MANIFEST_NAME}: run prepare-dist`];
  }

  const problems = [];
  const seen = new Set();
  for (const file of sources) {
    const key = toKey(dir, file);
    const entry = manifest.files[key];
    seen.add(key);
    if (!entry) {
      problems.push(`${key}: not in the manifest (added after prepare-dist)`);
    } else if (sha256(fs.readFileSync(file)) !== entry.sha256) {
      problems.push(`${key}: changed since prepare-dist`);
    } else {
      for (const extension of VARIANT_EXTENSIONS) {
        const listed = entry.variants.includes(extension);
        const present = fs.existsSync(`${file}.${extension}`);
        if (listed && !present) {
          problems.push(`${key}.${extension}: variant listed in the manifest is missing`);
        } else if (!listed && present) {
          problems.push(`${key}.${extension}: variant is not in the manifest`);
        }
      }
    }
  }
  for (const key of Object.keys(manifest.files)) {
    if (!seen.has(key)) {
      problems.push(`${key}: listed in the manifest but missing`);
    }
  }
  return problems;
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

  const { files, wellKnownFiles, symlinks, dotEntries } = scanDist(dir);
  const label = (file) => path.relative(dir, file);
  for (const link of symlinks) {
    problems.push(`${label(link)}: symbolic link (the server would follow it; use a real file)`);
  }
  for (const entry of dotEntries) {
    problems.push(`${label(entry)}: dot entry (never served; remove it from dist/)`);
  }

  for (const file of files) {
    const extension = path.extname(file).slice(1);
    if (!decoders[extension]) {
      continue;
    }

    const source = file.slice(0, -(extension.length + 1));
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      problems.push(`${label(file)}: variant has no source file`);
      continue;
    }

    let decoded;
    try {
      decoded = decoders[extension](fs.readFileSync(file));
    } catch {
      problems.push(`${label(file)}: cannot be decompressed`);
      continue;
    }
    if (!decoded.equals(fs.readFileSync(source))) {
      problems.push(`${label(file)}: does not match its source file (stale variant)`);
    }
  }

  const sources = [...files.filter((file) => !isVariant(file)), ...wellKnownFiles];
  problems.push(...manifestProblems(dir, sources));

  return { ok: problems.length === 0, problems };
}

if (require.main === module) {
  const dir = resolveDistDir(process.argv[2]);
  if (!reportVerification(dir, verifyDist(dir))) {
    process.exit(1);
  }
}

module.exports = { verifyDist };
