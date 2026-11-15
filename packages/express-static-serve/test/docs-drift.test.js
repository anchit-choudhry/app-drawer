const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ENV_NAMES } = require("../lib/config");

const repoRoot = path.join(__dirname, "..", "..", "..");
const absolute = (...parts) => path.join(repoRoot, ...parts);
const readText = (...parts) => fs.readFileSync(absolute(...parts), "utf8");
const readJson = (...parts) => JSON.parse(readText(...parts));
const lineAfterSplit = (text) => text.split("\n").map((line) => line.trimEnd());

// Markdown files directly inside a directory of the repository, as paths relative to the root.
function markdownIn(...dirParts) {
  const dir = absolute(...dirParts);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(...dirParts, entry.name));
}

// Every Markdown file under a directory, recursively, as paths relative to the root.
function markdownUnder(...dirParts) {
  const dir = absolute(...dirParts);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(...dirParts, entry.name);
    if (entry.isDirectory()) {
      return markdownUnder(...dirParts, entry.name);
    }
    return entry.name.endsWith(".md") ? [relative] : [];
  });
}

describe("agent guidance", () => {
  test("AGENTS.md exists and holds the middleware order", () => {
    assert.ok(fs.existsSync(absolute("AGENTS.md")), "AGENTS.md must exist");
    assert.match(
      readText("AGENTS.md"),
      /Helmet -> Morgan -> routes -> static files -> 404 handler -> error handler/
    );
  });

  test("CLAUDE.md imports AGENTS.md", () => {
    assert.ok(lineAfterSplit(readText("CLAUDE.md")).includes("@AGENTS.md"));
  });

  test("GEMINI.md imports AGENTS.md and keeps no TODO section of its own", () => {
    const lines = lineAfterSplit(readText("GEMINI.md"));
    assert.ok(lines.includes("@./AGENTS.md"));
    const todoHeadings = lines.filter((line) => /^#{1,6} /.test(line) && /TODO/i.test(line));
    assert.deepEqual(todoHeadings, []);
  });
});

describe("README configuration table", () => {
  test("lists exactly the supported environment variables", () => {
    const readme = readText("README.md");
    const documented = [...readme.matchAll(/^\| `([A-Z_]+)`/gm)].map((match) => match[1]).sort();
    assert.deepEqual(documented, [...ENV_NAMES, "NODE_ENV"].sort());
  });
});

describe("documented npm scripts", () => {
  const scripts = new Set([
    ...Object.keys(readJson("package.json").scripts),
    ...Object.keys(readJson("packages", "express-static-serve", "package.json").scripts),
  ]);
  const files = ["README.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "docs/runbook.md"];

  for (const file of files) {
    test(`every \`npm run\` in ${file} names a script that exists`, () => {
      assert.ok(fs.existsSync(absolute(file)), `${file} must exist`);
      const named = [...readText(file).matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]);
      const unknown = named.filter((name) => !scripts.has(name));
      assert.deepEqual(unknown, []);
    });
  }
});

describe("relative links", () => {
  const files = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    ".gemini/README.md",
    ...markdownUnder(".gemini", "agents"),
    ...markdownUnder(".gemini", "skills"),
    ...markdownIn("docs"),
    ...markdownIn("docs", "adr"),
  ];

  // The text without fenced code blocks, which hold examples and not links.
  function withoutFences(text) {
    let inside = false;
    return text
      .split("\n")
      .filter((line) => {
        if (/^\s*```/.test(line)) {
          inside = !inside;
          return false;
        }
        return !inside;
      })
      .join("\n");
  }

  function linkTargets(text) {
    const body = withoutFences(text);
    const inline = [...body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
    const references = [...body.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]);
    return [...inline, ...references]
      .filter((target) => !/^(https?:|mailto:|#)/.test(target))
      .map((target) => target.split("#")[0])
      .filter(Boolean);
  }

  test("the link collector reads inline links and reference definitions, and skips code", () => {
    const sample = [
      "See [a](docs/a.md) and [b](https://example.com) and [c](#top) and [d](x.md#frag).",
      "[ref]: ../y.md",
      "```",
      "[ignored](nowhere.md)",
      "```",
    ].join("\n");
    assert.deepEqual(linkTargets(sample), ["docs/a.md", "x.md", "../y.md"]);
  });

  for (const file of files) {
    test(`every relative link in ${file} points at a file that exists`, () => {
      assert.ok(fs.existsSync(absolute(file)), `${file} must exist`);
      const missing = linkTargets(readText(file)).filter(
        (target) => !fs.existsSync(path.resolve(path.dirname(absolute(file)), target))
      );
      assert.deepEqual(missing, []);
    });
  }
});

describe("workflow badges", () => {
  test("every workflow file the README links to exists", () => {
    const named = [...readText("README.md").matchAll(/actions\/workflows\/([\w.-]+\.ya?ml)/g)];
    const missing = named
      .map((match) => match[1])
      .filter((name) => !fs.existsSync(absolute(".github", "workflows", name)));
    assert.deepEqual(missing, []);
  });
});

describe("typography", () => {
  // Built from character codes, so that this file never contains the characters it forbids.
  const EN_DASH = String.fromCharCode(0x2013);
  const EM_DASH = String.fromCharCode(0x2014);
  const skipped = new Set([
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".remember",
    ".superpowers",
    ".idea",
    "super-linter-output",
    "package-lock.json",
    "LICENSE",
  ]);
  const checked = /\.(md|js|json|yml|yaml|ejs|sh)$/;

  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (skipped.has(entry.name) || entry.name.startsWith(".tmp-")) {
        return [];
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(full);
      }
      return checked.test(entry.name) || entry.name === "Dockerfile" ? [full] : [];
    });
  }

  test("no file uses an en dash or an em dash, except the line that names the rule", () => {
    const offenders = walk(repoRoot).flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => line.includes(EN_DASH) || line.includes(EM_DASH))
        .filter(({ line }) => !/en dashes/.test(line))
        .map(({ number }) => `${path.relative(repoRoot, file)}:${number}`)
    );
    assert.deepEqual(offenders, []);
  });
});

describe("package versions", () => {
  test("the root and the workspace package carry the same version", () => {
    assert.equal(
      readJson("packages", "express-static-serve", "package.json").version,
      readJson("package.json").version
    );
  });
});
