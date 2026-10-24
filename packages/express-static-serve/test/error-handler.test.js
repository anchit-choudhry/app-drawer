const { test, describe, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
// A TRUST_PROXY exported in the developer's shell must not change what these tests load.
delete process.env.TRUST_PROXY;
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
