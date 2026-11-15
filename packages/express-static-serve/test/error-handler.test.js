const { test, describe, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { errorHandler } = require("../server");

// Mounts the real error handler behind a route that fails however the test asks,
// so the handler is exercised through real Express rendering rather than fakes.
function appFailingWith(route) {
  const app = express();
  app.set("views", path.join(__dirname, "..", "views"));
  app.set("view engine", "ejs");
  app.get("/boom", route);
  app.use(errorHandler);
  return app;
}

function errorWithStatus(status) {
  const error = new Error("boom");
  error.status = status;
  return error;
}

describe("error handler status codes", () => {
  // The handler always logs via console.error; keep the test output pristine.
  before(() => mock.method(console, "error", () => {}));
  after(() => mock.restoreAll());

  test("keeps a client error status such as 404", async () => {
    const app = appFailingWith((req, res, next) => next(errorWithStatus(404)));
    const res = await request(app).get("/boom");
    assert.equal(res.status, 404);
    assert.match(res.text, /An error occurred!/);
  });

  test("keeps a server error status such as 503", async () => {
    const app = appFailingWith((req, res, next) => next(errorWithStatus(503)));
    const res = await request(app).get("/boom");
    assert.equal(res.status, 503);
  });

  test("falls back to 500 when the error status is a success code", async () => {
    const app = appFailingWith((req, res, next) => next(errorWithStatus(200)));
    const res = await request(app).get("/boom");
    assert.equal(res.status, 500);
  });

  test("falls back to 500 when the error status is not a valid HTTP code", async () => {
    const app = appFailingWith((req, res, next) => next(errorWithStatus(999)));
    const res = await request(app).get("/boom");
    assert.equal(res.status, 500);
    assert.match(res.text, /An error occurred!/);
  });

  test("falls back to 500 when the error status is not a number", async () => {
    const app = appFailingWith((req, res, next) => next(errorWithStatus("teapot")));
    const res = await request(app).get("/boom");
    assert.equal(res.status, 500);
  });
});

describe("error handler after the response has started", () => {
  before(() => mock.method(console, "error", () => {}));
  after(() => mock.restoreAll());

  test("delegates to Express instead of rendering over a partial response", async () => {
    const app = appFailingWith((req, res, next) => {
      res.write("partial body");
      next(new Error("failed mid-response"));
    });
    // Express's default handler destroys the socket when headers are already sent, so
    // the client sees the connection fail. A client-side timeout (ECONNABORTED) instead
    // means the handler left the response open, which is the bug this guards against.
    await assert.rejects(request(app).get("/boom").timeout(1500), (error) => {
      assert.notEqual(error.code, "ECONNABORTED", "response was left open by the handler");
      return true;
    });
  });
});

describe("error page hygiene", () => {
  before(() => mock.method(console, "error", () => {}));
  after(() => mock.restoreAll());

  test("an error page is never cached", async () => {
    const app = appFailingWith((req, res, next) => next(errorWithStatus(500)));
    const res = await request(app).get("/boom");
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("an error page drops the headers of the file that failed to send", async () => {
    // What express-static-gzip has already set when it fails to open a compressed variant.
    const fileEtag = 'W/"file-etag"';
    const app = appFailingWith((req, res, next) => {
      res.set({
        "Cache-Control": "public, max-age=7200",
        "Content-Encoding": "br",
        "Content-Type": "text/javascript",
        ETag: fileEtag,
        "Last-Modified": "Wed, 11 Nov 2026 10:47:23 GMT",
        "Accept-Ranges": "bytes",
      });
      next(errorWithStatus(500));
    });
    const res = await request(app).get("/boom");
    assert.equal(res.status, 500);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.match(res.headers["content-type"], /^text\/html/);
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.headers["last-modified"], undefined);
    assert.equal(res.headers["accept-ranges"], undefined);
    // Express may add an ETag for the page itself, but never the file's.
    assert.notEqual(res.headers.etag, fileEtag);
    assert.match(res.text, /An error occurred!/);
  });
});

describe("error page and a file's Content-Range", () => {
  before(() => mock.method(console, "error", () => {}));
  after(() => mock.restoreAll());

  const withRange = (status) =>
    appFailingWith((req, res, next) => {
      res.set("Content-Range", "bytes 0-3/10");
      next(errorWithStatus(status));
    });

  test("an error page does not describe a file's range, which would leak its size", async () => {
    const res = await request(withRange(500)).get("/boom");
    assert.equal(res.status, 500);
    assert.equal(res.headers["content-range"], undefined);
  });

  test("a 416 keeps the Content-Range that says which range would have been valid", async () => {
    const res = await request(withRange(416)).get("/boom");
    assert.equal(res.status, 416);
    assert.equal(res.headers["content-range"], "bytes 0-3/10");
  });
});
