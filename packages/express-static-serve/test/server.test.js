const { test, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const ejs = require("ejs");
const request = require("supertest");

// express-static-gzip indexes the dist directory when the app is required, so
// fixtures must exist on disk before `require("../server")` runs below.
const distDir = path.join(__dirname, "..", "dist");
const fixtureName = "hello.txt";
const fixtureContent = "hello world";
const fixturePath = path.join(distDir, fixtureName);
// Pre-compressed variants keyed by the file extension express-static-gzip matches on.
// zstd needs a recent Node (zlib.zstdCompressSync), so that variant is optional.
const variants = {
  br: zlib.brotliCompressSync(fixtureContent),
  gz: zlib.gzipSync(fixtureContent),
  zz: zlib.deflateSync(fixtureContent),
};
const zstdSupported = typeof zlib.zstdCompressSync === "function";
if (zstdSupported) {
  variants.zst = zlib.zstdCompressSync(fixtureContent);
}
const variantPath = (ext) => path.join(distDir, `${fixtureName}.${ext}`);
const variantPaths = Object.keys(variants).map(variantPath);

// Only remove dist/ afterward if this file is the one that created it - a
// pre-built production dist/ (per CLAUDE.md) must never be deleted by tests.
const distDirPreexisted = fs.existsSync(distDir);
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(fixturePath, fixtureContent);
for (const [ext, content] of Object.entries(variants)) {
  fs.writeFileSync(variantPath(ext), content);
}

const app = require("../server");

after(() => {
  if (distDirPreexisted) {
    fs.rmSync(fixturePath, { force: true });
    for (const variantPath of variantPaths) {
      fs.rmSync(variantPath, { force: true });
    }
  } else {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

describe("health check", () => {
  test("GET / reports UP status", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "UP" });
  });
});

describe("static file serving", () => {
  test("serves a file from dist with the documented Cache-Control header", async () => {
    const res = await request(app).get(`/${fixtureName}`);
    assert.equal(res.status, 200);
    assert.equal(res.text, fixtureContent);
    assert.match(res.headers["cache-control"], /public/);
    assert.match(res.headers["cache-control"], /max-age=7200/);
    assert.match(res.headers["cache-control"], /s-maxage=14400/);
    assert.match(res.headers["cache-control"], /proxy-revalidate/);
  });

  test("serves the brotli-compressed variant when the client accepts it", async () => {
    const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", "br");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-encoding"], "br");
  });

  test("serves the gzip variant when it is the only encoding accepted", async () => {
    const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", "gzip");
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(res.text, fixtureContent);
  });

  test("serves the deflate variant when it is the only encoding accepted", async () => {
    const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", "deflate");
    assert.equal(res.headers["content-encoding"], "deflate");
    assert.equal(res.text, fixtureContent);
  });

  test(
    "serves the zstd variant when the client accepts it",
    { skip: !zstdSupported && "zlib.zstdCompressSync is unavailable on this Node version" },
    async () => {
      const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", "zstd");
      assert.equal(res.headers["content-encoding"], "zstd");
    }
  );

  test(
    "prefers zstd, then brotli, then gzip, then deflate when several are accepted",
    { skip: !zstdSupported && "zlib.zstdCompressSync is unavailable on this Node version" },
    async () => {
      const accept = "deflate, gzip, br, zstd";
      const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", accept);
      assert.equal(res.headers["content-encoding"], "zstd");
    }
  );

  test("falls back to the uncompressed file when no encoding is accepted", async () => {
    const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", "identity");
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.text, fixtureContent);
  });

  test("varies the response on Accept-Encoding so caches keep variants apart", async () => {
    const res = await request(app).get(`/${fixtureName}`).set("Accept-Encoding", "br");
    assert.match(res.headers.vary, /Accept-Encoding/i);
  });
});

describe("error handling", () => {
  test("GET to an unknown path renders the 404 view", async () => {
    const res = await request(app).get("/does-not-exist");
    assert.equal(res.status, 404);
    assert.match(res.text, /Cannot find/);
  });
});

describe("security headers", () => {
  test("helmet applies a baseline security header", async () => {
    const res = await request(app).get("/");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  });
});

describe("500 view", () => {
  const viewPath = path.join(__dirname, "..", "views", "500.ejs");
  const error = new Error("sensitive internal detail");
  error.stack = "Error: sensitive internal detail\n    at somewhere";

  test("hides the error message and stack when verbose errors is off", async () => {
    const html = await ejs.renderFile(viewPath, { error, settings: { "verbose errors": false } });
    assert.doesNotMatch(html, /sensitive internal detail/);
    assert.doesNotMatch(html, /somewhere/);
  });

  test("includes the error message and stack when verbose errors is on", async () => {
    const html = await ejs.renderFile(viewPath, { error, settings: { "verbose errors": true } });
    assert.match(html, /sensitive internal detail/);
    assert.match(html, /somewhere/);
  });
});
