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

describe("Dockerfile", () => {
  const lines = instructions(readText("Dockerfile"));
  const nodeMajor = readText(".nvmrc").trim();

  test("builds every stage on the Node major pinned in .nvmrc", () => {
    const stages = lines.filter((line) => line.startsWith("FROM "));
    assert.ok(stages.length >= 1);
    for (const stage of stages) {
      assert.match(stage, new RegExp(`^FROM node:${nodeMajor}(-[a-z]+)?( AS \\w+)?$`));
    }
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
