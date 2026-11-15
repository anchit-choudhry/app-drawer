const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { checkCsp, findingsFor } = require("../scripts/check-csp");
const { CSP_DIRECTIVES } = require("../lib/security-headers");

// Both pages are kept here, not as files under test/, so no tool ever reads them as real pages.
const cleanPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>ok</title>
<link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="https://fonts.example/css">
<link rel="icon" href="data:image/png;base64,AAAA">
<link rel="canonical" href="https://site.example/">
<style>body { color: red; } a > b { x: "<script>" }</style>
<script src="/app.3f2a1b9c.js" defer></script>
<script type="application/ld+json">{"x":"<img src=https://evil.example/x.png>"}</script>
<!-- <script>alert(1)</script> <img src="https://evil.example/x.png" onerror=x> -->
</head><body style="margin:0">
<img src="logo.png" alt="a > b"><img src="data:image/gif;base64,R0lG" srcset="a.png 1x">
<a href="https://elsewhere.example/">out</a><form action="/search"></form>
<p title='one > two'>text with onclick= in prose</p>
<script src="app.js"></script><script></script>
</body></html>
`;

const dirtyPage = `<html><head>
<script>alert(1)</script>
<script src="https://cdn.example/lib.js"></script>
<script type="module">import "./x.js";</script>
<link rel="stylesheet" href="http://plain.example/a.css">
<link rel="icon" href="https://cdn.example/favicon.ico">
</head><body onload="go()">
<img src="https://other.example/p.png">
<img src="//other.example/q.png" srcset="https://other.example/r.png 2x, ok.png 1x">
<button onClick="x()">b</button>
<a href="javascript:void(0)">x</a>
<iframe src="https://video.example/embed"></iframe>
<object data="/flash.swf"></object>
<form action="https://collect.example/post"></form>
<video src="https://media.example/v.mp4"></video>
<base href="https://other.example/">
</body></html>
`;

const checkScript = path.join(__dirname, "..", "scripts", "check-csp.js");
const lineOf = (finding) => Number(finding.split(":")[0]);
const withSources = (directive, ...extra) => ({
  ...CSP_DIRECTIVES,
  [directive]: [...CSP_DIRECTIVES[directive], ...extra],
});

describe("findingsFor", () => {
  test("the clean page yields no finding", () => {
    assert.deepEqual(findingsFor(cleanPage), []);
  });

  test("the dirty page yields exactly these 15 findings, in this order", () => {
    assert.deepEqual(findingsFor(dirtyPage), [
      "2: inline <script> (blocked by script-src)",
      '3: <script src="https://cdn.example/lib.js"> (blocked by script-src)',
      "4: inline <script> (blocked by script-src)",
      '6: <link rel="icon" href="https://cdn.example/favicon.ico"> (blocked by img-src)',
      "7: onload handler on <body> (blocked by script-src-attr)",
      '8: <img src="https://other.example/p.png"> (blocked by img-src)',
      '9: <img src="//other.example/q.png"> (blocked by img-src)',
      '9: <img srcset="https://other.example/r.png"> (blocked by img-src)',
      "10: onclick handler on <button> (blocked by script-src-attr)",
      "11: javascript: URL on <a> (blocked by script-src-attr)",
      '12: <iframe src="https://video.example/embed"> (blocked by frame-src)',
      '13: <object data="/flash.swf"> (blocked by object-src)',
      '14: <form action="https://collect.example/post"> (blocked by form-action)',
      '15: <video src="https://media.example/v.mp4"> (blocked by media-src)',
      '16: <base href="https://other.example/"> (blocked by base-uri)',
    ]);
  });

  test("an http: stylesheet is not reported, because the policy upgrades it", () => {
    assert.ok(!findingsFor(dirtyPage).some((finding) => lineOf(finding) === 5));
  });

  test("img-src extended with another origin removes the findings on lines 8 and 9", () => {
    const found = findingsFor(dirtyPage, withSources("img-src", "https://other.example"));
    assert.deepEqual(
      found.map(lineOf),
      [2, 3, 4, 6, 7, 10, 11, 12, 13, 14, 15, 16]
    );
  });

  test("the sha256 hash of alert(1) in script-src removes line 2 only", () => {
    const hash = crypto.createHash("sha256").update("alert(1)").digest("base64");
    const found = findingsFor(dirtyPage, withSources("script-src", `'sha256-${hash}'`));
    assert.equal(found.length, 14);
    assert.ok(!found.some((finding) => lineOf(finding) === 2));
    assert.ok(found.some((finding) => lineOf(finding) === 4));
  });

  test("*.example in script-src removes line 3", () => {
    const found = findingsFor(dirtyPage, withSources("script-src", "*.example"));
    assert.ok(!found.some((finding) => lineOf(finding) === 3));
  });

  test("finds unquoted handlers, upper-case tags, and unterminated scripts", () => {
    assert.equal(findingsFor("<img src=x.png onerror=alert(1)>").length, 1);
    assert.equal(findingsFor("<SCRIPT>alert(1)</SCRIPT>").length, 1);
    assert.equal(findingsFor("<script>alert(1)").length, 1);
    assert.equal(findingsFor('<a href="x" onclick="y()">z</a>').length, 1);
  });

  test("does not flag what the policy allows", () => {
    assert.deepEqual(findingsFor('<div style="a:b">x</div>'), []);
    assert.deepEqual(findingsFor('<script type="application/ld+json">{"a":1}</script>'), []);
    assert.deepEqual(findingsFor('<img src="logo.png">'), []);
  });

  test("ignores markup inside a comment but keeps the line numbers", () => {
    const html = '<!--\n<script>alert(1)</script>\n-->\n<script>alert(2)</script>';
    assert.deepEqual(findingsFor(html), ["4: inline <script> (blocked by script-src)"]);
  });
});

describe("checkCsp", () => {
  let workDir;
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(__dirname, ".tmp-csp-"));
  });
  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });
  const write = (relative, content) => {
    const target = path.join(workDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  test("reports a missing directory", () => {
    const result = checkCsp(path.join(workDir, "missing"));
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /is not a directory/);
  });

  test("prefixes each finding with the file name relative to dist/", () => {
    write("sub/page.html", "<script>alert(1)</script>");
    const result = checkCsp(workDir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, [
      `${path.join("sub", "page.html")}:1: inline <script> (blocked by script-src)`,
    ]);
  });

  test("reads .html and .htm files and nothing else", () => {
    write("a.htm", "<script>alert(1)</script>");
    write("b.js", "<script>alert(1)</script>");
    write("c.html.br", "<script>alert(1)</script>");
    assert.equal(checkCsp(workDir).problems.length, 1);
  });

  test("does not read HTML inside a dot directory", () => {
    write(".hidden/page.html", "<script>alert(1)</script>");
    write(".well-known/page.html", "<script>alert(1)</script>");
    assert.deepEqual(checkCsp(workDir), { ok: true, problems: [] });
  });

  test("passes a directory of clean pages", () => {
    write("index.html", cleanPage);
    assert.deepEqual(checkCsp(workDir), { ok: true, problems: [] });
  });

  test("the command line prints dist CSP OK and exits 0 for a clean dist", () => {
    write("index.html", cleanPage);
    const result = spawnSync(process.execPath, [checkScript, workDir], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^dist CSP OK: /);
  });

  test("the command line lists the findings and exits 1 for a dirty dist", () => {
    write("index.html", dirtyPage);
    const result = spawnSync(process.execPath, [checkScript, workDir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dist CSP verification failed for /);
    assert.match(result.stderr, /index\.html:2: inline <script>/);
  });
});
