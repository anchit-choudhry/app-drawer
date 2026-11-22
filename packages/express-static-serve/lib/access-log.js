const morgan = require("morgan");

const number = (value) => (value === undefined ? null : Number(value));

// One JSON object per line. JSON.stringify escapes quotes and control characters, so text
// from a request cannot forge a second log line. Morgan already escapes every string its
// tokens return, which would escape request text twice, so the method, URL, referrer, and
// user agent are read from the request itself. The date, address, and numeric tokens hold
// nothing that needs escaping.
// JSON.stringify escapes the characters below U+0020, but leaves U+007F to U+009F and the line
// separators U+2028 and U+2029 as they are. A terminal reads some of them as control sequences
// and a log shipper may split a line at them, so they are escaped here, as Morgan does for its
// own format. They can only occur inside strings: every character of JSON's structure is ASCII.
const UNSAFE_IN_LOG = /[\u007f-\u009f\u2028\u2029]/g;
const escapeForLog = (text) =>
  text.replace(UNSAFE_IN_LOG, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

function jsonLine(tokens, req, res) {
  return escapeForLog(
    JSON.stringify({
      time: tokens.date(req, res, "iso"),
      remoteAddr: tokens["remote-addr"](req, res) ?? null,
      method: req.method,
      url: req.originalUrl || req.url,
      status: number(tokens.status(req, res)),
      bytes: number(tokens.res(req, res, "content-length")),
      responseTimeMs: number(tokens["response-time"](req, res)),
      referrer: req.headers.referer ?? req.headers.referrer ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    })
  );
}

function isHealthCheck(req) {
  const readOnly = req.method === "GET" || req.method === "HEAD";
  return readOnly && (req.originalUrl === "/" || req.originalUrl.startsWith("/?"));
}

// The "Morgan" stage of the middleware order.
function createAccessLog({ logFormat, logHealthChecks }, stream = process.stdout) {
  return morgan(logFormat === "json" ? jsonLine : "combined", {
    stream,
    skip: (req) => !logHealthChecks && isHealthCheck(req),
  });
}

module.exports = { createAccessLog, escapeForLog };
