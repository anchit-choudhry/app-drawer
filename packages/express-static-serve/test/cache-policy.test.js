const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { cachePolicyFor, cacheControlFor, CACHE_CONTROL } = require("../lib/cache-policy");

// File name -> policy. The names come from the plan's table; the second group of each policy
// covers names a real build produces.
const table = {
  immutable: [
    "app.3f2a1b9c.js",
    "app-3f2a1b9c.css",
    "app.3f2a1b9c.js.map",
    "/d/app.3f2a1b9c.js.br",
    "app.3f2a1b9c.min.js.zst",
    "chunk-5f3a9c1b.js",
    "vendor.a1b2c3d4e5f6.js",
    "main.0123456789abcdef.css.br",
  ],
  standard: [
    "index-DiwrgTda.js",
    "bootstrap-datepicker.js",
    "app.3F2A1B9C.js",
    "report-20261110.pdf",
    "x-deadbeef.js",
    "feedface1.js",
    "a.1234567.js",
    "hello.txt",
    "hello.txt.gz",
    "archive.gz",
    "robots.txt",
    "sw.js",
    "logo.12345678.png",
    ".well-known/security.txt",
  ],
  html: ["index.html", "sub/index.html.br", "page.HTM", "app.3f2a1b9c.html", "index.html.gz"],
};

describe("cachePolicyFor", () => {
  for (const [policy, names] of Object.entries(table)) {
    for (const name of names) {
      test(`${name} is ${policy}`, () => {
        assert.equal(cachePolicyFor(name), policy);
      });
    }
  }
});

describe("cacheControlFor", () => {
  test("returns the header string of the matching policy", () => {
    for (const [policy, names] of Object.entries(table)) {
      for (const name of names) {
        assert.equal(cacheControlFor(name), CACHE_CONTROL[policy], name);
      }
    }
  });

  test("the three header values", () => {
    assert.equal(CACHE_CONTROL.immutable, "public, max-age=31536000, immutable");
    assert.equal(CACHE_CONTROL.html, "no-cache");
    assert.equal(
      CACHE_CONTROL.standard,
      "public, max-age=7200, must-revalidate, s-maxage=14400, proxy-revalidate"
    );
  });
});
