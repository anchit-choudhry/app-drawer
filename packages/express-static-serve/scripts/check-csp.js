const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CSP_DIRECTIVES } = require("../lib/security-headers");
const { listFiles, resolveDistDir, reportVerification } = require("./dist-common");

const HTML_FILE = /\.html?$/i;
const TAG_OPEN = /<[a-zA-Z]/g;
// A start tag: its name, then attributes in which a quoted value may hold ">". The lookahead
// after the name allows only one way to split name from attributes, which keeps a tag that never
// closes from being retried at every length of its name.
const TAG_SOURCE = "<([a-zA-Z][^\\s/>]*)(?=[\\s/>])((?:\"[^\"]*\"|'[^']*'|[^'\">])*)>";
const UNPARSED_TAG = "start tag could not be parsed, the rest of the page was not checked";
// What ends a comment: "-->", or "--!>", which a browser accepts too.
const COMMENT_END = /--!?>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const HASH_SOURCE = /^'(sha256|sha384|sha512)-([A-Za-z0-9+/=_-]+)'$/;
// Script types that hold data and are never run.
const DATA_BLOCK_TYPE = /^(application\/(ld\+)?json|text\/(plain|html|template|x-.+))$/;
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "data"];

// Where a directive looks when it is not set. Anything not listed falls back to default-src.
const FALLBACKS = {
  "script-src-attr": ["script-src", "default-src"],
  "style-src-attr": ["style-src", "default-src"],
  "frame-src": ["child-src", "default-src"],
  "form-action": [],
  "base-uri": [],
};

// [tag, attribute, directive] for every element that loads a URL.
const URL_RULES = [
  ["script", "src", "script-src"],
  ["img", "src", "img-src"],
  ["iframe", "src", "frame-src"],
  ["frame", "src", "frame-src"],
  ["audio", "src", "media-src"],
  ["video", "src", "media-src"],
  ["source", "src", "media-src"],
  ["track", "src", "media-src"],
  ["object", "data", "object-src"],
  ["embed", "src", "object-src"],
  ["form", "action", "form-action"],
  ["base", "href", "base-uri"],
];

const LINK_RELS = {
  stylesheet: "style-src",
  icon: "img-src",
  "apple-touch-icon": "img-src",
  manifest: "manifest-src",
  modulepreload: "script-src",
};

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) {
      attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
    }
  }
  return attributes;
}

// Where the comment that opens at `open` ends, or -1 when it never does. "<!-->" and "<!--->" are
// complete comments in a browser, so the text after them is live markup.
function commentEnd(html, open) {
  const body = open + 4;
  if (html.startsWith(">", body)) {
    return body + 1;
  }
  if (html.startsWith("->", body)) {
    return body + 2;
  }
  const ending = new RegExp(COMMENT_END);
  ending.lastIndex = body;
  const found = ending.exec(html);
  return found === null ? -1 : found.index + found[0].length;
}

// Blanks every comment, not removes it, so that line numbers stay right. This is linear: a "<!--"
// with no ending after it is left as it is, and then no later one can be closed either.
function blankComments(html) {
  const parts = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf("<!--", from);
    const end = open === -1 ? -1 : commentEnd(html, open);
    if (end === -1) {
      break;
    }
    parts.push(html.slice(from, open), html.slice(open, end).replace(/[^\n]/g, " "));
    from = end;
  }
  parts.push(html.slice(from));
  return parts.join("");
}

// Yields every start tag with its attributes and line number. For script and style it also
// yields the text inside, and skips over it so that markup inside code is not read as tags.
// A start tag this scanner cannot parse (no closing ">", or a quote that never closes, which
// includes an apostrophe inside an unquoted value that a browser would accept) ends the scan with
// `{ unterminated: true, line }`, and the caller reports it. Trying every later "<" again would
// make the cost grow with the square of the page.
function* startTags(html) {
  const text = blankComments(html);
  const opening = new RegExp(TAG_OPEN);
  const tag = new RegExp(TAG_SOURCE, "y");
  let from = 0;
  let line = 1;
  // Each line break is found once, so counting lines never rescans the text before a tag.
  let nextBreak = text.indexOf("\n");
  for (;;) {
    opening.lastIndex = from;
    const found = opening.exec(text);
    if (found === null) {
      return;
    }
    while (nextBreak !== -1 && nextBreak < found.index) {
      line += 1;
      nextBreak = text.indexOf("\n", nextBreak + 1);
    }
    tag.lastIndex = found.index;
    const match = tag.exec(text);
    if (match === null) {
      yield { unterminated: true, line };
      return;
    }
    const name = match[1].toLowerCase();
    let content = "";
    from = tag.lastIndex;
    if (name === "script" || name === "style") {
      const closing = new RegExp(`</${name}\\s*>`, "gi");
      closing.lastIndex = from;
      const end = closing.exec(text);
      content = text.slice(from, end === null ? text.length : end.index);
      from += content.length;
    }
    yield { name, attributes: parseAttributes(match[2]), content, line };
  }
}

// The source list that governs `name`, or null when nothing restricts it.
function sourcesFor(directives, name) {
  for (const candidate of [name, ...(FALLBACKS[name] ?? ["default-src"])]) {
    if (directives[candidate]) {
      return [...directives[candidate]];
    }
  }
  return null;
}

function classify(url) {
  const value = url.trim();
  if (/^javascript:/i.test(value)) return "javascript";
  if (/^data:/i.test(value)) return "data";
  if (/^blob:/i.test(value)) return "blob";
  if (/^https:\/\//i.test(value) || value.startsWith("//")) return "https";
  if (/^http:\/\//i.test(value)) return "http";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "other";
  return "self";
}

// True when a host source such as cdn.example.com or *.example.com covers the URL's host.
function hostAllowed(sources, url) {
  const value = url.trim();
  let host;
  try {
    host = new URL(value.startsWith("//") ? `https:${value}` : value).host;
  } catch {
    return false;
  }
  return sources.some((source) => {
    const pattern = source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "");
    if (pattern === "" || pattern.startsWith("'") || pattern.endsWith(":")) {
      return false;
    }
    return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;
  });
}

function urlAllowed(directives, directive, url) {
  const sources = sourcesFor(directives, directive);
  if (sources === null) {
    return true;
  }
  if (sources.includes("'none'")) {
    return false;
  }
  let kind = classify(url);
  // The browser rewrites http: subresources to https: before the policy is applied.
  if (kind === "http" && "upgrade-insecure-requests" in directives) {
    kind = "https";
  }
  if (kind === "self") {
    return sources.includes("'self'") || sources.includes("*");
  }
  if (kind === "data" || kind === "blob") {
    return sources.includes(`${kind}:`);
  }
  if (kind === "https" || kind === "http") {
    return sources.includes("*") || sources.includes(`${kind}:`) || hostAllowed(sources, url);
  }
  return false;
}

// Inline code runs when its hash is listed, or when 'unsafe-inline' is set and no hash or
// nonce is (browsers ignore 'unsafe-inline' next to those).
function inlineAllowed(directives, directive, content) {
  const sources = sourcesFor(directives, directive);
  if (sources === null) {
    return true;
  }
  const hashes = sources.map((source) => HASH_SOURCE.exec(source)).filter(Boolean);
  const hashed = hashes.some(
    ([, algorithm, digest]) =>
      crypto.createHash(algorithm).update(content).digest("base64") === digest
  );
  const strict = hashes.length > 0 || sources.some((source) => source.startsWith("'nonce-"));
  return hashed || (!strict && sources.includes("'unsafe-inline'"));
}

// Every place in one HTML document that `directives` would block, as "line: what (why)".
function findingsFor(html, directives = CSP_DIRECTIVES) {
  const findings = [];
  const add = (line, what, directive) => {
    findings.push(`${line}: ${what} (blocked by ${directive})`);
  };

  for (const { name, attributes, content, line, unterminated } of startTags(html)) {
    if (unterminated) {
      findings.push(`${line}: ${UNPARSED_TAG}`);
      break;
    }
    for (const [tag, attribute, directive] of URL_RULES) {
      const url = tag === name ? attributes[attribute] : undefined;
      if (url && !urlAllowed(directives, directive, url)) {
        add(line, `<${name} ${attribute}="${url}">`, directive);
      }
    }

    if (name === "link" && attributes.href) {
      for (const rel of (attributes.rel ?? "").toLowerCase().split(/\s+/)) {
        const directive = LINK_RELS[rel];
        if (directive && !urlAllowed(directives, directive, attributes.href)) {
          add(line, `<link rel="${rel}" href="${attributes.href}">`, directive);
        }
      }
    }

    if (name === "img" && attributes.srcset) {
      for (const candidate of attributes.srcset.split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url && !urlAllowed(directives, "img-src", url)) {
          add(line, `<img srcset="${url}">`, "img-src");
        }
      }
    }

    const type = (attributes.type ?? "").trim().toLowerCase();
    const runs = name === "script" && !("src" in attributes) && !DATA_BLOCK_TYPE.test(type);
    if (runs && content.trim() !== "" && !inlineAllowed(directives, "script-src", content)) {
      add(line, "inline <script>", "script-src");
    }
    if (name === "style" && content.trim() !== "") {
      if (!inlineAllowed(directives, "style-src", content)) {
        add(line, "inline <style>", "style-src");
      }
    }

    for (const [attribute, value] of Object.entries(attributes)) {
      const inline = (directive) => inlineAllowed(directives, directive, value);
      if (/^on[a-z]+$/.test(attribute) && !inline("script-src-attr")) {
        add(line, `${attribute} handler on <${name}>`, "script-src-attr");
      }
      if (attribute === "style" && !inline("style-src-attr")) {
        add(line, `style attribute on <${name}>`, "style-src-attr");
      }
      const scripted = URL_ATTRIBUTES.includes(attribute) && classify(value) === "javascript";
      if (scripted && !inline("script-src-attr")) {
        add(line, `javascript: URL on <${name}>`, "script-src-attr");
      }
    }
  }
  return findings;
}

// Checks every HTML file in dist/ against the policy the server sends.
function checkCsp(dir, directives = CSP_DIRECTIVES) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, problems: [`${dir} is not a directory`] };
  }
  const problems = listFiles(dir)
    .filter((file) => HTML_FILE.test(file))
    .flatMap((file) => {
      const label = path.relative(dir, file);
      return findingsFor(fs.readFileSync(file, "utf8"), directives).map(
        (finding) => `${label}:${finding}`
      );
    });
  return { ok: problems.length === 0, problems };
}

if (require.main === module) {
  const dir = resolveDistDir(process.argv[2]);
  if (!reportVerification(dir, checkCsp(dir), "dist CSP")) {
    process.exit(1);
  }
}

module.exports = { checkCsp, findingsFor };
