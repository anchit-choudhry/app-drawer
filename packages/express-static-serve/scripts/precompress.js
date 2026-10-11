const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { shouldCompress, LEVELS } = require("./compression-policy");

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
const variantExtensions = Object.keys(encoders);

function isVariant(file) {
  return variantExtensions.some((extension) => file.endsWith(`.${extension}`));
}

// Symlinks are skipped so a link inside dist/ can never pull in a file from outside it.
function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return entry.isFile() && !isVariant(entryPath) ? [entryPath] : [];
  });
}

function precompress(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`${dir} is not a directory`);
  }

  const summary = { compressed: 0, skipped: 0, bytesBefore: 0, bytesAfter: 0 };

  for (const file of listSourceFiles(dir)) {
    const content = fs.readFileSync(file);
    const eligible = shouldCompress(file, content.length);
    let smallest = null;

    for (const extension of variantExtensions) {
      const target = `${file}.${extension}`;
      const variant = eligible ? encoders[extension](content) : null;
      if (variant && variant.length < content.length) {
        fs.writeFileSync(target, variant);
        smallest = Math.min(smallest ?? Infinity, variant.length);
      } else {
        // A variant left over from an earlier build would be served in place of the
        // current file, so drop it whenever a fresh one is not written.
        fs.rmSync(target, { force: true });
      }
    }

    if (smallest === null) {
      summary.skipped += 1;
    } else {
      summary.compressed += 1;
      summary.bytesBefore += content.length;
      summary.bytesAfter += smallest;
    }
  }

  return summary;
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));
  try {
    const { compressed, skipped, bytesBefore, bytesAfter } = precompress(dir);
    console.log(
      `Precompressed ${compressed} file(s), skipped ${skipped}: ` +
        `${bytesBefore} -> ${bytesAfter} bytes (best variant per file) in ${dir}`
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { precompress };
