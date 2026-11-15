const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const readText = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

// Instruction lines with comments removed and backslash continuations joined.
const instructions = (text) =>
  text
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

// Every file reached from `entry` through require("./...") or require("../...").
function localModules(entry, seen = new Set()) {
  if (seen.has(entry)) {
    return seen;
  }
  seen.add(entry);
  const source = fs.readFileSync(entry, "utf8");
  for (const [, request] of source.matchAll(/require\("(\.{1,2}\/[^"]+)"\)/g)) {
    localModules(require.resolve(path.resolve(path.dirname(entry), request)), seen);
  }
  return seen;
}

// The source paths of every COPY that takes files from the build context.
function copiedPaths(lines) {
  return lines
    .filter((line) => line.startsWith("COPY ") && !line.includes("--from="))
    .flatMap((line) => line.split(/\s+/).slice(1, -1))
    .filter((part) => !part.startsWith("--"));
}

describe("Dockerfile", () => {
  const lines = instructions(readText("Dockerfile"));
  const nodeMajor = readText(".nvmrc").trim();

  test("builds every stage on the Node major pinned in .nvmrc, pinned by digest", () => {
    const stages = lines.filter((line) => line.startsWith("FROM "));
    assert.ok(stages.length >= 1);
    for (const stage of stages) {
      const pinned = `^FROM node:${nodeMajor}-slim@sha256:[0-9a-f]{64}( AS \\w+)?$`;
      assert.match(stage, new RegExp(pinned));
    }
  });

  test("every stage uses the same digest", () => {
    const digests = lines
      .filter((line) => line.startsWith("FROM "))
      .map((line) => /@sha256:([0-9a-f]{64})/.exec(line)?.[1]);
    assert.ok(digests.every(Boolean), "every stage must carry a digest");
    assert.equal(new Set(digests).size, 1, `found ${[...new Set(digests)].join(", ")}`);
  });

  test("copies every local module the server loads", () => {
    const packageDir = path.join(repoRoot, "packages", "express-static-serve");
    const sources = copiedPaths(lines);
    const missing = [...localModules(path.join(packageDir, "server.js"))]
      .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
      .filter(
        (file) => !sources.some((source) => file === source || file.startsWith(`${source}/`))
      );
    assert.deepEqual(missing, [], "these modules are loaded by the server but not copied");
  });

  test("installs no PM2 into the image: it is a root dependency, not the workspace's", () => {
    const install = lines.find((line) => /^RUN npm ci /.test(line));
    assert.match(install, /--workspace=express-static-serve/);
    assert.match(install, /--omit=dev/);
  });

  test("installs production dependencies only, strictly from the lockfile", () => {
    assert.ok(lines.some((line) => /^RUN npm ci --omit=dev\b/.test(line)));
    assert.ok(lines.some((line) => /^COPY \.npmrc\b/.test(line)));
  });

  test("never copies dist/ into the image", () => {
    const copies = lines.filter((line) => /^(COPY|ADD) /.test(line));
    assert.ok(copies.length > 0);
    assert.deepEqual(
      copies.filter((line) => /\bdist\b/.test(line)),
      []
    );
  });

  test("runs as a non-root numeric user in production mode", () => {
    const users = lines.filter((line) => line.startsWith("USER "));
    assert.match(users.at(-1), /^USER [1-9][0-9]*(:[0-9]+)?$/);
    assert.ok(lines.some((line) => /^ENV .*NODE_ENV=production\b/.test(line)));
  });

  test("starts the server directly with the same node flag as PM2, without --permission", () => {
    const cmd = lines.find((line) => line.startsWith("CMD "));
    assert.ok(cmd, "a CMD instruction is required");
    assert.match(cmd, /"--disable-proto=delete"/);
    assert.match(cmd, /packages\/express-static-serve\/server\.js/);
    assert.doesNotMatch(cmd, /--permission/);
  });

  test("has a health check against GET /", () => {
    const health = lines.find((line) => line.startsWith("HEALTHCHECK "));
    assert.ok(health, "a HEALTHCHECK instruction is required");
    assert.match(health, /127\.0\.0\.1/);
  });
});

describe(".dockerignore", () => {
  const entries = instructions(readText(".dockerignore"));

  test("keeps dist/, node_modules, tests and local state out of the build context", () => {
    const required = ["**/dist", "**/node_modules", ".git", "packages/express-static-serve/test"];
    for (const entry of required) {
      assert.ok(entries.includes(entry), `${entry} must be ignored`);
    }
  });

  test("does not ignore the .npmrc that the install step copies", () => {
    assert.ok(!entries.includes(".npmrc"));
  });
});
