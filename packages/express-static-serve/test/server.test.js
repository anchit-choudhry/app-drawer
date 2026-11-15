const { test, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const zlib = require("node:zlib");
const ejs = require("ejs");
const request = require("supertest");
const http = require("node:http");
const { createApp, applyTimeouts } = require("../server");
const { makeDist, removeDir } = require("./helpers");

const fixtureName = "hello.txt";
const fixtureContent = "hello world";
const page = "<!doctype html><title>page</title>\n";
const script = "console.log(1);\n";
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

// express-static-gzip indexes the directory when the app is created, so the fixture must exist
// before createApp runs. It is a scratch directory, never the package's own dist/.
const distDir = makeDist({
  [fixtureName]: fixtureContent,
  "index.html": page,
  "index.html.br": zlib.brotliCompressSync(page),
  "sub/index.html": page,
  "sub/index.html.br": zlib.brotliCompressSync(page),
  "app.3f2a1b9c.js": script,
  "app.3f2a1b9c.js.br": zlib.brotliCompressSync(script),
  ".well-known/security.txt": "Contact: https://example.com/security\n",
  ".well-known/.hidden": "hidden",
  ".env": "SECRET=1",
  ...Object.fromEntries(
    Object.entries(variants).map(([ext, content]) => [`${fixtureName}.${ext}`, content])
  ),
});
const app = createApp({ distDir });

after(() => removeDir(distDir));

describe("health check", () => {
  test("GET / reports UP status", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "UP" });
  });

  test("GET / is never cached, so a CDN cannot keep serving a stale UP", async () => {
    const res = await request(app).get("/");
    assert.equal(res.headers["cache-control"], "no-store");
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

  test("the 404 view says the page was not found, in its title and heading", async () => {
    const res = await request(app).get("/does-not-exist");
    assert.match(res.text, /<title>Not Found<\/title>/);
    assert.match(res.text, /<h1>Page not found<\/h1>/);
    assert.match(res.text, /Cannot find \/does-not-exist/);
  });
});

describe("cache policy by file name", () => {
  const standard = "public, max-age=7200, must-revalidate, s-maxage=14400, proxy-revalidate";
  const immutable = "public, max-age=31536000, immutable";

  test("HTML is revalidated on every use, at the root and in a subfolder", async () => {
    assert.equal((await request(app).get("/index.html")).headers["cache-control"], "no-cache");
    const sub = await request(app).get("/sub/");
    assert.equal(sub.status, 200);
    assert.equal(sub.headers["cache-control"], "no-cache");
  });

  test("a compressed variant of a page is revalidated too", async () => {
    const res = await request(app).get("/index.html").set("Accept-Encoding", "br");
    assert.equal(res.headers["content-encoding"], "br");
    assert.equal(res.headers["cache-control"], "no-cache");
  });

  test("a hex-hashed file is immutable, with and without a compressed variant", async () => {
    const plain = await request(app).get("/app.3f2a1b9c.js").set("Accept-Encoding", "identity");
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.equal(plain.headers["cache-control"], immutable);
    const brotli = await request(app).get("/app.3f2a1b9c.js").set("Accept-Encoding", "br");
    assert.equal(brotli.headers["content-encoding"], "br");
    assert.equal(brotli.headers["cache-control"], immutable);
  });

  test("any other file keeps the 2 hour policy", async () => {
    const res = await request(app).get(`/${fixtureName}`);
    assert.equal(res.headers["cache-control"], standard);
  });

  test("a well-known file keeps the 2 hour policy", async () => {
    const res = await request(app).get("/.well-known/security.txt");
    assert.equal(res.headers["cache-control"], standard);
  });
});

describe("redirects", () => {
  test("the redirect from a folder to its slash is not kept as a permanent one", async () => {
    const res = await request(app).get("/sub");
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, "/sub/");
    assert.equal(res.headers["cache-control"], "no-cache");
  });
});

describe("error pages are never cached", () => {
  test("a 404 carries Cache-Control: no-store", async () => {
    const res = await request(app).get("/does-not-exist");
    assert.equal(res.status, 404);
    assert.equal(res.headers["cache-control"], "no-store");
  });
});

describe("health check while draining", () => {
  test("answers 503 DRAINING, uncached, while files are still served", async () => {
    const draining = createApp({ distDir });
    draining.set("draining", true);
    const health = await request(draining).get("/");
    assert.equal(health.status, 503);
    assert.deepEqual(health.body, { status: "DRAINING" });
    assert.equal(health.headers["cache-control"], "no-store");
    assert.equal((await request(draining).get(`/${fixtureName}`)).status, 200);
  });

  test("answers 200 UP when it is not draining", async () => {
    const res = await request(createApp({ distDir })).get("/");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "UP" });
  });
});

describe("applyTimeouts", () => {
  test("sets the keep-alive and headers timeouts from the config", () => {
    const server = http.createServer();
    applyTimeouts(server, { keepAliveTimeoutMs: 65000, headersTimeoutMs: 66000 });
    assert.equal(server.keepAliveTimeout, 65000);
    assert.equal(server.headersTimeout, 66000);
  });

  test("leaves both at Node's defaults when the config has none", () => {
    const server = http.createServer();
    const { keepAliveTimeout, headersTimeout } = server;
    applyTimeouts(server, { keepAliveTimeoutMs: undefined, headersTimeoutMs: undefined });
    assert.equal(server.keepAliveTimeout, keepAliveTimeout);
    assert.equal(server.headersTimeout, headersTimeout);
  });

  test("sets one without touching the other", () => {
    const server = http.createServer();
    const { headersTimeout } = server;
    applyTimeouts(server, { keepAliveTimeoutMs: 2000, headersTimeoutMs: undefined });
    assert.equal(server.keepAliveTimeout, 2000);
    assert.equal(server.headersTimeout, headersTimeout);
  });
});

describe("methods other than GET and HEAD", () => {
  for (const method of ["post", "put", "patch", "delete"]) {
    for (const target of ["/hello.txt", "/"]) {
      test(`${method.toUpperCase()} ${target} answers 405 with an Allow header`, async () => {
        const res = await request(app)[method](target);
        assert.equal(res.status, 405);
        assert.equal(res.headers.allow, "GET, HEAD");
        assert.equal(res.headers["cache-control"], "no-store");
        // express-static-gzip sets these for the file before it falls through; the page is
        // plain HTML and must not carry them.
        assert.equal(res.headers["content-encoding"], undefined);
        assert.match(res.headers["content-type"], /^text\/html/);
        assert.match(res.text, /<title>Method Not Allowed<\/title>/);
        assert.match(res.text, new RegExp(method.toUpperCase()));
      });
    }
  }

  test("HEAD of an existing file answers 200 and of a missing one 404", async () => {
    assert.equal((await request(app).head("/hello.txt")).status, 200);
    assert.equal((await request(app).head("/missing")).status, 404);
  });
});

describe("well-known files", () => {
  test("serves a file under /.well-known/", async () => {
    const res = await request(app).get("/.well-known/security.txt");
    assert.equal(res.status, 200);
    assert.equal(res.text, "Contact: https://example.com/security\n");
  });

  test("answers 404 for a missing well-known file", async () => {
    assert.equal((await request(app).get("/.well-known/missing")).status, 404);
  });

  test("keeps dotfiles inside .well-known hidden", async () => {
    assert.equal((await request(app).get("/.well-known/.hidden")).status, 404);
  });

  test("keeps every other dot path hidden", async () => {
    assert.equal((await request(app).get("/.env")).status, 404);
  });
});

describe("proxy trust", () => {
  test("trusts no proxy by default, as a number rather than a string", () => {
    assert.strictEqual(app.get("trust proxy"), 0);
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

  test("renders without title data and keeps a generic title and one heading", async () => {
    const html = await ejs.renderFile(viewPath, { error, settings: { "verbose errors": false } });
    assert.match(html, /<title>Error<\/title>/);
    assert.equal(html.match(/An error occurred!/g).length, 1);
  });

  test("includes the error message and stack when verbose errors is on", async () => {
    const html = await ejs.renderFile(viewPath, { error, settings: { "verbose errors": true } });
    assert.match(html, /sensitive internal detail/);
    assert.match(html, /somewhere/);
  });
});
