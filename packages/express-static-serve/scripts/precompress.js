const fs = require("fs");
const zlib = require("zlib");
const { shouldCompress, LEVELS } = require("./compression-policy");
const { scanDist, isVariant, resolveDistDir, VARIANT_EXTENSIONS } = require("./dist-common");
const {
  sha256,
  toKey,
  policyFingerprint,
  readManifest,
  writeManifest,
} = require("./dist-manifest");

// Keyed by the file extension express-static-gzip matches on (see server.js).
const encoders = {
  br: (buffer) =>
    zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: LEVELS.br },
    }),
  gz: (buffer) => zlib.gzipSync(buffer, { level: LEVELS.gz }),
  zz: (buffer) => zlib.deflateSync(buffer, { level: LEVELS.zz }),
  zst: (buffer) =>
    zlib.zstdCompressSync(buffer, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: LEVELS.zst },
    }),
};

// The last manifest, when it can be trusted to describe the files on disk: it must be valid
// and written under the same compression policy.
function loadPrevious(dir) {
  try {
    const manifest = readManifest(dir);
    return manifest && manifest.policy === policyFingerprint() ? manifest : null;
  } catch {
    return null;
  }
}

// True when the variants on disk are exactly the ones the entry lists.
function variantsMatch(file, entry) {
  return VARIANT_EXTENSIONS.every(
    (extension) => fs.existsSync(`${file}.${extension}`) === entry.variants.includes(extension)
  );
}

function precompress(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`${dir} is not a directory`);
  }

  const previous = loadPrevious(dir);
  const { files, wellKnownFiles } = scanDist(dir);
  const summary = { compressed: 0, skipped: 0, unchanged: 0, bytesBefore: 0, bytesAfter: 0 };
  // No prototype, so a file named __proto__ is recorded like any other instead of being lost.
  const entries = Object.create(null);

  for (const file of files.filter((candidate) => !isVariant(candidate))) {
    const content = fs.readFileSync(file);
    const key = toKey(dir, file);
    const hash = sha256(content);
    const known = previous?.files[key];
    // Same content, same policy, same variants: the work is already done.
    if (known && known.sha256 === hash && variantsMatch(file, known)) {
      entries[key] = known;
      summary.unchanged += 1;
      continue;
    }

    const eligible = shouldCompress(file, content.length);
    const written = [];
    let smallest = null;
    for (const extension of VARIANT_EXTENSIONS) {
      const target = `${file}.${extension}`;
      const variant = eligible ? encoders[extension](content) : null;
      if (variant && variant.length < content.length) {
        // Removed first: if the name is a symlink, writing would follow it to its target.
        fs.rmSync(target, { force: true });
        fs.writeFileSync(target, variant);
        written.push(extension);
        smallest = Math.min(smallest ?? Infinity, variant.length);
      } else {
        // A variant left over from an earlier build would be served in place of the
        // current file, so drop it whenever a fresh one is not written.
        fs.rmSync(target, { force: true });
      }
    }
    entries[key] = { sha256: hash, size: content.length, variants: written };

    if (smallest === null) {
      summary.skipped += 1;
    } else {
      summary.compressed += 1;
      summary.bytesBefore += content.length;
      summary.bytesAfter += smallest;
    }
  }

  // Served as they are, so they are recorded but never compressed.
  for (const file of wellKnownFiles) {
    const content = fs.readFileSync(file);
    entries[toKey(dir, file)] = { sha256: sha256(content), size: content.length, variants: [] };
  }

  writeManifest(dir, entries);
  return summary;
}

function formatSummary({ compressed, skipped, unchanged, bytesBefore, bytesAfter }, dir) {
  return (
    `Precompressed ${compressed} file(s), skipped ${skipped}, unchanged ${unchanged}: ` +
    `${bytesBefore} -> ${bytesAfter} bytes (best variant per file) in ${dir}`
  );
}

if (require.main === module) {
  const dir = resolveDistDir(process.argv[2]);
  try {
    console.log(formatSummary(precompress(dir), dir));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { precompress, formatSummary };
