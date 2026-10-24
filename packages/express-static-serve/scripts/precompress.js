const fs = require("fs");
const zlib = require("zlib");
const { shouldCompress, LEVELS } = require("./compression-policy");
const { listFiles, resolveDistDir } = require("./dist-common");

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

function listSourceFiles(dir) {
  return listFiles(dir).filter((file) => !isVariant(file));
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

function formatSummary({ compressed, skipped, bytesBefore, bytesAfter }, dir) {
  return (
    `Precompressed ${compressed} file(s), skipped ${skipped}: ` +
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
