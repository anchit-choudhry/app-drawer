const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { createAccessLog, escapeForLog } = require("../lib/access-log");

// A small app behind the access log, with the lines it wrote collected in `lines`.
function appWith(config) {
  const lines = [];
  const app = express();
  app.use(createAccessLog(config, { write: (line) => lines.push(line) }));
  app.get("/", (req, res) => res.json({ status: "UP" }));
  app.get("/file", (req, res) => res.send("file"));
  app.post("/", (req, res) => res.send("posted"));
  return { app, lines };
}

const defaults = { logFormat: "combined", logHealthChecks: true };

describe("combined format", () => {
  test("writes one Apache combined line per request", async () => {
    const { app, lines } = appWith(defaults);
    await request(app).get("/file");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /"GET \/file HTTP\/1\.1" 200 4 /);
  });
});

describe("json format", () => {
  const json = { logFormat: "json", logHealthChecks: true };

  test("writes one parseable line with exactly the documented keys", async () => {
    const { app, lines } = appWith(json);
    await request(app).get("/file").set("Referer", "http://example.test/");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(entry), [
      "time",
      "remoteAddr",
      "method",
      "url",
      "status",
      "bytes",
      "responseTimeMs",
      "referrer",
      "userAgent",
    ]);
    assert.equal(entry.method, "GET");
    assert.equal(entry.url, "/file");
    assert.equal(entry.status, 200);
    assert.equal(typeof entry.status, "number");
    assert.equal(entry.bytes, 4);
    assert.equal(typeof entry.responseTimeMs, "number");
    assert.equal(entry.referrer, "http://example.test/");
    assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  test("gives back exactly the text a request sent, with one line per request", async () => {
    // Morgan 1.12.1 escapes the string every token returns, so reading these through the
    // tokens would store them escaped twice. A quote, a backslash, and a backslash followed by n.
    const agent = 'agent"quote\\back\\nslash';
    const referrer = 'http://example.test/"q"\\';
    const { app, lines } = appWith(json);
    await request(app).get("/file").set("User-Agent", agent).set("Referer", referrer);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].trim().split("\n").length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.userAgent, agent);
    assert.equal(entry.referrer, referrer);
  });

  test("uses null for a header the request did not send", async () => {
    const { app, lines } = appWith(json);
    await request(app).get("/file").unset("User-Agent");
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.userAgent, null);
    assert.equal(entry.referrer, null);
  });
});

describe("json format and control characters", () => {
  const json = { logFormat: "json", logHealthChecks: true };

  test("C1 control characters are escaped, as in the combined format", async () => {
    // Node reads header bytes as latin1, so a byte 0x9b reaches the log as U+009B: a terminal
    // reads it as an escape sequence introducer, and U+0085 and U+2028 can split a line for a
    // log shipper. JSON.stringify alone leaves all of them as they are.
    const agent = "a\u009b[31mb\u0085c";
    const { app, lines } = appWith(json);
    await request(app).get("/file").set("User-Agent", agent);
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0], /[\u007f-\u009f\u2028\u2029]/);
    assert.match(lines[0], /\\u009b/);
    assert.equal(JSON.parse(lines[0]).userAgent, agent);
  });

  test("DEL and the whole C1 range are escaped by escapeForLog", () => {
    // A client cannot send DEL in a header, but a raw socket can.
    assert.equal(escapeForLog("a\u007fb"), "a\\u007fb");
    assert.equal(escapeForLog("\u0080\u009f"), "\\u0080\\u009f");
    assert.equal(escapeForLog("plain \"text\" \\ é"), "plain \"text\" \\ é");
  });

  test("the line separators U+2028 and U+2029 are escaped too", async () => {
    const { app, lines } = appWith(json);
    await request(app).get("/file").set("Referer", "http://example.test/?a=1");
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.referrer, "http://example.test/?a=1");
    // Built from character codes, so this file holds no raw separator.
    const separators = String.fromCharCode(0x2028, 0x2029);
    const text = escapeForLog(JSON.stringify({ x: `a${separators}b` }));
    assert.doesNotMatch(text, new RegExp(`[${separators}]`));
    assert.deepEqual(JSON.parse(text), { x: `a${separators}b` });
  });
});

describe("LOG_HEALTH_CHECKS=false", () => {
  const quiet = { logFormat: "combined", logHealthChecks: false };

  test("writes nothing for GET /, HEAD /, and GET /?probe=1", async () => {
    const { app, lines } = appWith(quiet);
    await request(app).get("/");
    await request(app).head("/");
    await request(app).get("/?probe=1");
    assert.deepEqual(lines, []);
  });

  test("still writes a line for another path and for POST /", async () => {
    const { app, lines } = appWith(quiet);
    await request(app).get("/file");
    await request(app).post("/");
    assert.equal(lines.length, 2);
  });

  test("logs health checks when it is true", async () => {
    const { app, lines } = appWith(defaults);
    await request(app).get("/");
    assert.equal(lines.length, 1);
  });
});

describe("values a request or response may lack", () => {
  const json = { logFormat: "json", logHealthChecks: true };

  test("a streamed response has no content-length, so bytes is null", async () => {
    const lines = [];
    const app = express();
    app.use(createAccessLog(json, { write: (line) => lines.push(line) }));
    app.get("/stream", (req, res) => {
      res.write("a");
      res.end("b");
    });
    await request(app).get("/stream");
    assert.equal(JSON.parse(lines[0]).bytes, null);
  });

  test("a Referrer header spelled with two r's is read when Referer is absent", async () => {
    const { app, lines } = appWith(json);
    await request(app).get("/file").set("Referrer", "http://example.test/typo");
    assert.equal(JSON.parse(lines[0]).referrer, "http://example.test/typo");
  });

  test("outside Express, where there is no originalUrl, the URL comes from req.url", async () => {
    const lines = [];
    const log = createAccessLog(json, { write: (line) => lines.push(line) });
    // A plain Node handler: nothing here sets req.originalUrl.
    await request((req, res) => log(req, res, () => res.end("ok"))).get("/plain?x=1");
    assert.equal(JSON.parse(lines[0]).url, "/plain?x=1");
  });
});
