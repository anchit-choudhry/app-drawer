const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../server");
const { makeDist, removeDir } = require("./helpers");

const snapshotPath = path.join(__dirname, "fixtures", "response-headers.json");
const ROUTES = { "GET /": "/", "GET /hello.txt": "/hello.txt", "GET /missing": "/missing" };
// These differ per response or per file and are asserted in other tests.
const VOLATILE = ["date", "etag", "last-modified", "content-length", "connection", "keep-alive"];

// Values are split into their parts so that the long policies stay readable in a diff and
// inside the 100 character line limit.
function stableHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !VOLATILE.includes(name))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, value]) => [name, value.split(/[;,]/).map((part) => part.trim())])
  );
}

describe("response header contract", () => {
  let distDir;
  let app;

  before(() => {
    distDir = makeDist({ "hello.txt": "hello world" });
    app = createApp({ distDir });
  });

  after(() => removeDir(distDir));

  test("the health check, a file, and a 404 send exactly the recorded headers", async () => {
    const actual = {};
    for (const [label, url] of Object.entries(ROUTES)) {
      const res = await request(app).get(url);
      actual[label] = stableHeaders(res.headers);
    }
    if (process.env.UPDATE_SNAPSHOTS === "1") {
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    assert.deepEqual(
      actual,
      expected,
      "Response headers changed. If that is intended, record them again with " +
        "UPDATE_SNAPSHOTS=1 and review the diff of test/fixtures/response-headers.json."
    );
  });
});
