const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../server");
const { precompress } = require("../scripts/precompress");
const { verifyDist } = require("../scripts/verify-dist");
const { httpRequest, listenLocal } = require("./helpers");

const MARKER = "TOP-SECRET-MARKER";
const page = "<!doctype html><title>site</title>\n".repeat(60);

let root;
let site;
let server;
let port;

// Every response in this file, whatever its status, carries the baseline security headers.
async function send(urlPath, options) {
  const res = await httpRequest(port, urlPath, options);
  const label = `${options?.method ?? "GET"} ${urlPath}`;
  assert.equal(res.headers["x-content-type-options"], "nosniff", `${label}: nosniff`);
  assert.ok(res.headers["content-security-policy"], `${label}: a Content-Security-Policy`);
  return res;
}

before(async () => {
  // A scratch root: site/ is the served directory and secret.txt sits next to it, outside it.
  root = fs.mkdtempSync(path.join(__dirname, ".tmp-sec-"));
  site = path.join(root, "site");
  fs.mkdirSync(path.join(site, ".well-known"), { recursive: true });
  fs.mkdirSync(path.join(site, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "secret.txt"), MARKER);
  fs.writeFileSync(path.join(site, "index.html"), page);
  fs.writeFileSync(path.join(site, "hello.txt"), "hello world");
  fs.writeFileSync(path.join(site, "sub", "index.html"), page);
  fs.writeFileSync(path.join(site, ".well-known", "security.txt"), "Contact: x\n");
  precompress(site);
  // Created after precompress, so that they exist when the requests are made.
  fs.writeFileSync(path.join(site, ".env"), "SECRET=1");
  fs.mkdirSync(path.join(site, ".git"), { recursive: true });
  fs.writeFileSync(path.join(site, ".git", "config"), "[core]");
  fs.writeFileSync(path.join(site, "sub", ".hidden"), "hidden");
  fs.symlinkSync(path.join(root, "secret.txt"), path.join(site, "link.txt"));
  server = await listenLocal(createApp({ distDir: site }));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("path traversal", () => {
  const paths = [
    "/../secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e/secret.txt",
    "/%2e%2e%2fsecret.txt",
    "/..%5csecret.txt",
    "/....//secret.txt",
    "/sub/../../secret.txt",
    "/%252e%252e/secret.txt",
    "/%c0%ae%c0%ae/secret.txt",
    "/secret.txt%00.html",
    "/%00",
    "/%",
  ];
  for (const urlPath of paths) {
    test(`${urlPath} is refused and never reveals the file`, async () => {
      const res = await send(urlPath);
      assert.ok([400, 403, 404].includes(res.status), `status ${res.status}`);
      assert.doesNotMatch(res.body, new RegExp(MARKER));
    });
  }
});

describe("hidden files", () => {
  for (const urlPath of ["/.env", "/.git/config", "/.dist-manifest.json", "/sub/.hidden"]) {
    test(`${urlPath} answers 404`, async () => {
      assert.equal((await send(urlPath)).status, 404);
    });
  }
});

describe(".well-known", () => {
  test("/.well-known/security.txt is served", async () => {
    const res = await send("/.well-known/security.txt");
    assert.equal(res.status, 200);
    assert.equal(res.body, "Contact: x\n");
  });

  for (const urlPath of ["/.well-known/../secret.txt", "/.well-known/%2e%2e/%2e%2e/secret.txt"]) {
    test(`${urlPath} does not reach outside it`, async () => {
      const res = await send(urlPath);
      assert.notEqual(res.status, 200);
      assert.doesNotMatch(res.body, new RegExp(MARKER));
    });
  }
});

describe("reflected input", () => {
  for (const urlPath of ["/<script>alert(1)</script>", "/%3Cscript%3Ealert(1)%3C%2Fscript%3E"]) {
    test(`${urlPath} is escaped on the 404 page`, async () => {
      const res = await send(urlPath);
      assert.equal(res.status, 404);
      assert.doesNotMatch(res.body, /<script>alert\(1\)/);
    });
  }
});

describe("methods", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "TRACE"]) {
    for (const urlPath of ["/", "/index.html", "/missing"]) {
      test(`${method} ${urlPath} answers 405 with Allow: GET, HEAD`, async () => {
        const res = await send(urlPath, { method });
        assert.equal(res.status, 405);
        assert.equal(res.headers.allow, "GET, HEAD");
      });
    }
  }
});

describe("health check", () => {
  test("/?x=1 still answers UP", async () => {
    const res = await send("/?x=1");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { status: "UP" });
  });
});

describe("symbolic links", () => {
  test("verify-dist reports a link to a file outside dist/", () => {
    const { ok, problems } = verifyDist(site);
    assert.equal(ok, false);
    const reported = problems.some((problem) => /link\.txt: symbolic link/.test(problem));
    assert.ok(reported, problems.join("\n"));
  });

  test("the server follows a symlink, which is why verify-dist rejects them", async () => {
    const res = await send("/link.txt");
    assert.equal(res.status, 200);
    assert.equal(res.body, MARKER);
  });
});
