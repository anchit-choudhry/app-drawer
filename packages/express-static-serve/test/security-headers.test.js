const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helmet = require("helmet");
const request = require("supertest");
const { createApp } = require("../server");
const { CSP_DIRECTIVES, PERMISSIONS_POLICY } = require("../lib/security-headers");
const { makeDist, removeDir } = require("./helpers");

// "default-src 'self'; upgrade-insecure-requests" -> { "default-src": ["'self'"], ... }
function parsePolicy(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      })
  );
}

describe("Content-Security-Policy", () => {
  test("is Helmet's default policy, held in one place", () => {
    assert.deepEqual(CSP_DIRECTIVES, helmet.contentSecurityPolicy.getDefaultDirectives());
  });

  test("the header a real response carries equals CSP_DIRECTIVES", async () => {
    const distDir = makeDist({});
    try {
      const res = await request(createApp({ distDir })).get("/");
      assert.deepEqual(parsePolicy(res.headers["content-security-policy"]), CSP_DIRECTIVES);
    } finally {
      removeDir(distDir);
    }
  });
});

describe("Permissions-Policy", () => {
  let distDir;
  let app;
  before(() => {
    distDir = makeDist({ "hello.txt": "hello world" });
    app = createApp({ distDir });
  });
  after(() => removeDir(distDir));

  const responses = {
    "the health check": () => request(app).get("/"),
    "a file": () => request(app).get("/hello.txt"),
    "a 404": () => request(app).get("/missing"),
    "a 405": () => request(app).post("/"),
  };
  for (const [label, send] of Object.entries(responses)) {
    test(`${label} denies the sensor and device features`, async () => {
      const header = (await send()).headers["permissions-policy"];
      assert.equal(header, PERMISSIONS_POLICY);
      assert.match(header, /camera=\(\)/);
      assert.match(header, /geolocation=\(\)/);
    });
  }

  test("every denied feature is written as feature=()", () => {
    for (const part of PERMISSIONS_POLICY.split(", ")) {
      assert.match(part, /^[a-z-]+=\(\)$/);
    }
  });
});
