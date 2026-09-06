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
const fixtureBrPath = path.join(distDir, `${fixtureName}.br`);

// Only remove dist/ afterward if this file is the one that created it - a
// pre-built production dist/ (per CLAUDE.md) must never be deleted by tests.
const distDirPreexisted = fs.existsSync(distDir);
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(fixturePath, fixtureContent);
fs.writeFileSync(fixtureBrPath, zlib.brotliCompressSync(fixtureContent));

const app = require("../server");

after(() => {
  if (distDirPreexisted) {
    fs.rmSync(fixturePath, { force: true });
    fs.rmSync(fixtureBrPath, { force: true });
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
