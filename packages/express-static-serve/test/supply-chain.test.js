const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const readText = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");
const readJson = (...parts) => JSON.parse(readText(...parts));

// Parses "key=value" lines of an .npmrc, ignoring blank lines and comments.
function parseNpmrc(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"))
      .map((line) => line.split("=").map((part) => part.trim()))
  );
}

describe("npm configuration", () => {
  test("blocks dependency lifecycle scripts from running during install", () => {
    assert.equal(parseNpmrc(readText(".npmrc"))["ignore-scripts"], "true");
  });

  test("refuses to install on a Node version outside the declared engines range", () => {
    assert.equal(parseNpmrc(readText(".npmrc"))["engine-strict"], "true");
  });

  test("waits at least 7 days before resolving a newly published version", () => {
    const days = Number(parseNpmrc(readText(".npmrc"))["min-release-age"]);
    assert.ok(days >= 7, `min-release-age must be at least 7 days, got ${days}`);
  });

  test("pins the package manager with a sha512 integrity hash", () => {
    const { packageManager } = readJson("package.json");
    assert.match(packageManager, /^npm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });
});

describe("lockfile supply chain", () => {
  const lock = readJson("package-lock.json");
  // Only node_modules/ entries are downloaded. The root entry, the workspace's own source
  // folder, and the workspace symlink (link: true) all live in this repo instead.
  const downloaded = Object.entries(lock.packages).filter(
    ([name, info]) => name.startsWith("node_modules/") && !info.link
  );

  test("resolves every downloaded package from the public npm registry over https", () => {
    const offenders = downloaded
      .filter(([, info]) => !String(info.resolved).startsWith("https://registry.npmjs.org/"))
      .map(([name, info]) => `${name} -> ${info.resolved}`);
    assert.deepEqual(offenders, []);
  });

  test("records an integrity hash for every downloaded package", () => {
    const missing = downloaded.filter(([, info]) => !info.integrity).map(([name]) => name);
    assert.deepEqual(missing, []);
  });

  test("declares no git, file, or url dependency specifiers in either manifest", () => {
    const manifests = [
      readJson("package.json"),
      readJson("packages", "express-static-serve", "package.json"),
    ];
    const groups = ["dependencies", "devDependencies", "optionalDependencies", "overrides"];
    const nonRegistrySpec = /^(git|github:|file:|https?:|\.{1,2}\/)/;
    const offenders = manifests
      .flatMap((manifest) => groups.map((group) => manifest[group] ?? {}))
      .flatMap((group) => Object.entries(group))
      .filter(([, spec]) => typeof spec === "string" && nonRegistrySpec.test(spec))
      .map(([name, spec]) => `${name}@${spec}`);
    assert.deepEqual(offenders, []);
  });
});

describe("GitHub workflows", () => {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  const workflows = fs
    .readdirSync(workflowDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => ({ file, text: fs.readFileSync(path.join(workflowDir, file), "utf8") }));

  test("every workflow declares a top-level permissions block", () => {
    const missing = workflows
      .filter(({ text }) => !/^permissions:/m.test(text))
      .map(({ file }) => file);
    assert.deepEqual(missing, []);
  });

  test("every third-party action and reusable workflow is pinned to a commit SHA", () => {
    const unpinned = workflows.flatMap(({ file, text }) =>
      [...text.matchAll(/^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)/gm)]
        .map((match) => match[1])
        .filter((ref) => !ref.startsWith("./"))
        .filter((ref) => !/@[0-9a-f]{40}$/.test(ref))
        .map((ref) => `${file}: ${ref}`)
    );
    assert.deepEqual(unpinned, []);
  });

  test("Dependabot keeps both npm packages and GitHub Actions up to date", () => {
    const dependabot = fs.readFileSync(path.join(repoRoot, ".github", "dependabot.yml"), "utf8");
    assert.match(dependabot, /package-ecosystem:\s*["']npm["']/);
    assert.match(dependabot, /package-ecosystem:\s*["']github-actions["']/);
  });

  test("a CI workflow installs from the lockfile and runs the tests with the coverage gate", () => {
    const ci = workflows.find(({ file }) => file === "ci.yml");
    assert.ok(ci, "ci.yml must exist");
    assert.match(ci.text, /npm ci/);
    assert.match(ci.text, /test:coverage/);
    assert.match(ci.text, /audit:signatures/);
  });
});
